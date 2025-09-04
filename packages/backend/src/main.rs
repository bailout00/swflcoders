use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
#[cfg(feature = "dev")]
use types::ChatMessage;
#[cfg(feature = "dev")]
use uuid::Uuid;
// WebSocket support imports - will be used for message handling
// use futures_util::{sink::SinkExt, stream::StreamExt};

use std::net::SocketAddr;
#[cfg(feature = "dev")]
use std::sync::Arc;
#[cfg(feature = "dev")]
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::CorsLayer;
// use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use types::{HealthCheck, SendMessageRequest};
// use tower::ServiceExt; // Unused for now, but will be needed for Lambda
use aws_sdk_dynamodb::Client as DynamoDbClient;
use serde::Deserialize;
use serde_json::json;
use std::{env, sync::LazyLock};
#[cfg(feature = "dev")]
use tokio::sync::mpsc;

use backend::handlers;

// Tables configuration
static TABLES: LazyLock<handlers::Tables> = LazyLock::new(|| handlers::Tables::from_env());

#[cfg(feature = "dev")]
static CHAT_CONNECTIONS_TABLE: LazyLock<String> = LazyLock::new(|| {
    env::var("CONNECTIONS_TABLE").expect("CONNECTIONS_TABLE environment variable must be set")
});

#[cfg(feature = "dev")]
static DEV_PUBLIC_BASE_URL: LazyLock<Option<String>> =
    LazyLock::new(|| env::var("DEV_PUBLIC_BASE_URL").ok());

#[derive(Clone)]
struct AppState {
    ddb: DynamoDbClient,
    tables: handlers::Tables,
    metrics: backend::MetricsHelper,
    // In-memory broadcast channels keyed by room id (dev only)
    #[cfg(feature = "dev")]
    channels: Arc<RwLock<std::collections::HashMap<String, broadcast::Sender<String>>>>,
    // Per-connection senders for targeted push (dev only)
    #[cfg(feature = "dev")]
    conn_senders: Arc<RwLock<std::collections::HashMap<String, mpsc::Sender<String>>>>,
}

// Error handling for the API
#[derive(Debug)]
struct AppError {
    message: String,
    status_code: StatusCode,
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        let body = json!({
            "error": self.message,
            "code": self.status_code.as_u16()
        });

        (self.status_code, Json(body)).into_response()
    }
}

// Helper to create AppError from any error
impl AppError {
    fn from_error<E: std::fmt::Debug>(err: E) -> Self {
        tracing::error!("DynamoDB error: {:?}", err);
        Self {
            message: "Internal server error".to_string(),
            status_code: StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "backend=debug,tower_http=debug,axum::rejection=trace".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize AWS config and DynamoDB client
    let aws_config = if let Ok(endpoint) = env::var("DYNAMODB_ENDPOINT") {
        // Use local DynamoDB for development
        tracing::info!("Using local DynamoDB endpoint: {}", endpoint);
        aws_config::defaults(aws_config::BehaviorVersion::latest())
            .endpoint_url(endpoint)
            .load()
            .await
    } else {
        // Use AWS DynamoDB
        aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await
    };

    let ddb_client = DynamoDbClient::new(&aws_config);

    // Use static constants for table names - will panic at startup if not set
    let tables = TABLES.clone();

    tracing::info!("Using tables: rooms={}, messages={}", tables.rooms, tables.messages);

    // Initialize metrics helper
    let metrics = backend::MetricsHelper::new().await;

    let state = AppState {
        ddb: ddb_client,
        tables,
        metrics,
        #[cfg(feature = "dev")]
        channels: Arc::new(RwLock::new(std::collections::HashMap::new())),
        #[cfg(feature = "dev")]
        conn_senders: Arc::new(RwLock::new(std::collections::HashMap::new())),
    };

    // Check if running in AWS Lambda
    if std::env::var("AWS_LAMBDA_FUNCTION_NAME").is_ok() {
        tracing::warn!("Lambda mode detected but integration temporarily disabled. Running in compatibility mode.");
        // TODO: Re-enable Lambda integration once we resolve HTTP version conflicts
    }

    // Running locally - use axum server
    let app = create_app(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    tracing::info!("listening on {}", addr);
    axum::Server::bind(&addr).serve(app.into_make_service()).await.unwrap();
}

fn create_app(state: AppState) -> Router {
    let base = Router::new()
        .route("/health", get(health_handler))
        .route("/chat/messages", post(post_message_handler))
        .route("/chat/messages/:room_id", get(get_messages_handler))
        .route("/ws", get(websocket_handler));

    #[cfg(feature = "dev")]
    let base = base.route("/dev/conn/:connection_id/send", post(dev_conn_send_handler));

    base.with_state(state)
        // Enable CORS for development
        .layer(CorsLayer::permissive())
    // TODO: Re-add tracing layer after fixing HTTP version conflicts
    // .layer(TraceLayer::new_for_http())
}

async fn health_handler() -> Result<Json<HealthCheck>, StatusCode> {
    match handlers::health_handler().await {
        Ok(health_check) => Ok(Json(health_check)),
        Err(err) => {
            tracing::error!("Health check failed: {}", err);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// POST /chat/messages - Send a new message
async fn post_message_handler(
    State(state): State<AppState>,
    Json(request): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!("Received message request for room: {}", request.room_id);

    match handlers::post_message_handler(&state.ddb, &state.tables, request).await {
        Ok(message) => {
            // Emit metrics for REST message post
            state.metrics.emit_message_sent(&message.room_id, message.message_text.len()).await;
            Ok((StatusCode::CREATED, Json(message)))
        }
        Err(err) => {
            tracing::error!("Failed to post message: {}", err);
            Err(AppError { message: err, status_code: StatusCode::INTERNAL_SERVER_ERROR })
        }
    }
}

// GET /chat/messages/:room_id - Retrieve last 25 messages
async fn get_messages_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!("Retrieving messages for room: {}", room_id);

    match handlers::get_messages_handler(&state.ddb, &state.tables, room_id).await {
        Ok(response) => Ok(Json(response)),
        Err(err) => {
            tracing::error!("Failed to get messages: {}", err);
            Err(AppError { message: err, status_code: StatusCode::INTERNAL_SERVER_ERROR })
        }
    }
}

// WebSocket query parameters
#[derive(Debug, Deserialize)]
struct WebSocketParams {
    room_id: Option<String>,
    #[serde(rename = "userId")]
    user_id: Option<String>,
    username: Option<String>,
}

// WebSocket handler for development
async fn websocket_handler(
    ws: WebSocketUpgrade,
    Query(params): Query<WebSocketParams>,
    #[cfg(feature = "dev")] State(state): State<AppState>,
) -> Response {
    let room_id = params.room_id.unwrap_or_else(|| "general".to_string());
    let user_id = params.user_id.unwrap_or_else(|| "dev-user".to_string());
    let username = params.username.unwrap_or_else(|| "Developer".to_string());

    tracing::info!(
        "WebSocket connection request: room={}, user={}, username={}",
        room_id,
        user_id,
        username
    );

    ws.on_upgrade(move |socket| {
        handle_websocket(
            socket,
            room_id,
            user_id,
            username,
            #[cfg(feature = "dev")]
            state,
        )
    })
}

// WebSocket connection handler
async fn handle_websocket(
    mut socket: WebSocket,
    room_id: String,
    user_id: String,
    username: String,
    #[cfg(feature = "dev")] state: AppState,
) {
    tracing::info!("WebSocket connected: {} ({}) in room {}", username, user_id, room_id);

    #[cfg(feature = "dev")]
    let tx = {
        let mut channels = state.channels.write().await;
        if let Some(existing) = channels.get(&room_id) {
            existing.clone()
        } else {
            let (tx, _rx) = broadcast::channel::<String>(100);
            channels.insert(room_id.clone(), tx.clone());
            tx
        }
    };

    #[cfg(feature = "dev")]
    let mut rx = tx.subscribe();

    // For development, create a per-connection sender and store connection in DynamoDB
    #[cfg(feature = "dev")]
    let connection_id = Uuid::new_v4().to_string();
    #[cfg(feature = "dev")]
    let (conn_tx, mut conn_rx) = mpsc::channel::<String>(100);
    #[cfg(feature = "dev")]
    {
        use std::collections::HashMap;

        use aws_sdk_dynamodb::types::AttributeValue;

        state.conn_senders.write().await.insert(connection_id.clone(), conn_tx);

        // Compute public push URL (for broadcaster Lambda to call)
        let base = DEV_PUBLIC_BASE_URL.clone();
        let base = base.as_deref().unwrap_or("http://localhost:3001");
        let push_url = format!("{}/dev/conn/{}/send", base.trim_end_matches('/'), connection_id);

        // Write connection record to DynamoDB
        let now = chrono::Utc::now().timestamp_millis();
        let ttl = now / 1000 + (60 * 60 * 24);

        let mut item = HashMap::new();
        item.insert("connection_id".to_string(), AttributeValue::S(connection_id.clone()));
        item.insert("room_id".to_string(), AttributeValue::S(room_id.clone()));
        item.insert("user_id".to_string(), AttributeValue::S(user_id.clone()));
        item.insert("username".to_string(), AttributeValue::S(username.clone()));
        item.insert("connected_at".to_string(), AttributeValue::N(now.to_string()));
        item.insert("domain".to_string(), AttributeValue::S("local".to_string()));
        item.insert("stage".to_string(), AttributeValue::S("local".to_string()));
        item.insert("transport".to_string(), AttributeValue::S("dev".to_string()));
        item.insert("push_url".to_string(), AttributeValue::S(push_url));
        item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));

        if let Err(e) = state
            .ddb
            .put_item()
            .table_name(&*CHAT_CONNECTIONS_TABLE)
            .set_item(Some(item))
            .send()
            .await
        {
            tracing::error!("Failed to write dev connection record: {:?}", e);
        }
    }

    // Handle incoming messages
    #[cfg(feature = "dev")]
    {
        loop {
            tokio::select! {
                // Outbound server -> client messages (room fan-out)
                received = rx.recv() => {
                    match received {
                        Ok(payload) => {
                            if let Err(e) = socket.send(Message::Text(payload)).await {
                                tracing::warn!("Failed to send to {} in room {}: {}", username, room_id, e);
                                break;
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::info!("Broadcast channel closed for room {}", room_id);
                            break;
                        }
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            tracing::warn!("WebSocket for user {} lagged by {} messages in room {}", username, skipped, room_id);
                        }
                    }
                }
                // Targeted per-connection push
                msg_to_send = conn_rx.recv() => {
                    if let Some(payload) = msg_to_send {
                        if let Err(e) = socket.send(Message::Text(payload)).await {
                            tracing::warn!("Failed to send targeted message to {}: {}", username, e);
                            break;
                        }
                    } else {
                        // Sender dropped
                        break;
                    }
                }
                // Inbound client -> server messages (ignored in dev)
                msg = socket.recv() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            tracing::info!("Received WebSocket message from {}: {}", username, text);
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            tracing::info!("WebSocket connection closed for user {}", username);
                            break;
                        }
                        Some(Err(e)) => {
                            tracing::error!("WebSocket error for user {}: {}", username, e);
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    #[cfg(not(feature = "dev"))]
    {
        // Minimal loop: only consume client messages and close
        while let Some(msg) = socket.recv().await {
            match msg {
                Ok(Message::Text(text)) => {
                    tracing::info!("Received WebSocket message from {}: {}", username, text);
                }
                Ok(Message::Close(_)) => {
                    tracing::info!("WebSocket connection closed for user {}", username);
                    break;
                }
                Err(e) => {
                    tracing::error!("WebSocket error for user {}: {}", username, e);
                    break;
                }
                _ => {}
            }
        }
    }

    tracing::info!("WebSocket disconnected: {} ({}) from room {}", username, user_id, room_id);

    // Cleanup dev connection mapping and DynamoDB record
    #[cfg(feature = "dev")]
    {
        use aws_sdk_dynamodb::types::AttributeValue;
        state.conn_senders.write().await.remove(&connection_id);
        if let Err(e) = state
            .ddb
            .delete_item()
            .table_name(&*CHAT_CONNECTIONS_TABLE)
            .key("connection_id", AttributeValue::S(connection_id))
            .send()
            .await
        {
            tracing::warn!("Failed to delete dev connection record: {:?}", e);
        }
    }
}

// Dev-only: Per-connection send endpoint for broadcaster Lambda to push to a specific connection
#[cfg(feature = "dev")]
async fn dev_conn_send_handler(
    State(state): State<AppState>,
    Path(connection_id): Path<String>,
    Json(message): Json<ChatMessage>,
) -> Result<impl IntoResponse, AppError> {
    let payload = serde_json::to_string(&message).map_err(AppError::from_error)?;

    let maybe_sender = { state.conn_senders.read().await.get(&connection_id).cloned() };
    if let Some(sender) = maybe_sender {
        if let Err(_e) = sender.send(payload).await {
            return Ok((StatusCode::GONE, Json(json!({ "status": "gone" }))));
        }
        Ok((StatusCode::OK, Json(json!({ "status": "ok" }))))
    } else {
        Ok((StatusCode::NOT_FOUND, Json(json!({ "status": "not_found" }))))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
    use backend::handlers::Tables;
    // use http_body_util::BodyExt; // Unused due to test simplification
    use tower::ServiceExt;

    #[tokio::test]
    #[ignore] // TODO: Fix body collection issue
    async fn test_health_endpoint() {
        // Create a mock DynamoDB client for testing
        let aws_config = aws_config::defaults(aws_config::BehaviorVersion::latest()).load().await;
        let ddb_client = DynamoDbClient::new(&aws_config);
        let metrics = backend::MetricsHelper::new().await;
        let state = AppState {
            ddb: ddb_client,
            tables: Tables {
                messages: "chat-messages".to_string(),
                rooms: "chat-rooms".to_string(),
            },
            metrics,
        };

        let app = create_app(state);

        let response = app
            .oneshot(
                Request::builder().method(Method::GET).uri("/health").body(Body::empty()).unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        // TODO: Add body deserialization test when body collection is fixed
    }
}
