use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use chrono::Utc;
use std::net::SocketAddr;
// use tower_http::cors::CorsLayer;
// use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use types::{
    HealthCheck, HealthStatus, ChatMessage, SendMessageRequest, GetMessagesResponse,
};
// use tower::ServiceExt; // Unused for now, but will be needed for Lambda
use aws_sdk_dynamodb::{
    Client as DynamoDbClient,
    types::AttributeValue,
};
use std::{
    env,
    collections::HashMap,
};
use uuid::Uuid;
use serde_json::json;

#[derive(Clone)]
struct AppState {
    ddb: DynamoDbClient,
    rooms_table: String,
    messages_table: String,
    metrics: backend::MetricsHelper,
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
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                "backend=debug,tower_http=debug,axum::rejection=trace".into()
            }),
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
    
    // Read environment variables for table names
    let rooms_table = env::var("CHAT_ROOMS_TABLE")
        .unwrap_or_else(|_| "chat-rooms-local".to_string());
    let messages_table = env::var("CHAT_MESSAGES_TABLE")
        .unwrap_or_else(|_| "chat-messages-local".to_string());
    
    tracing::info!("Using tables: rooms={}, messages={}", rooms_table, messages_table);
    
    // Initialize metrics helper
    let metrics = backend::MetricsHelper::new().await;
    
    let state = AppState {
        ddb: ddb_client,
        rooms_table,
        messages_table,
        metrics,
    };

    // Check if running in AWS Lambda
    if std::env::var("AWS_LAMBDA_FUNCTION_NAME").is_ok() {
        tracing::warn!("Lambda mode detected but integration temporarily disabled. Running in compatibility mode.");
        // TODO: Re-enable Lambda integration once we resolve HTTP version conflicts
    }
    
    // Running locally - use axum server
    let app = create_app(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    tracing::info!("listening on {}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

fn create_app(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health_handler))
        .route("/chat/messages", post(post_message_handler))
        .route("/chat/messages/:room_id", get(get_messages_handler))
        .with_state(state)
        // TODO: Re-add CORS and tracing layers after fixing HTTP version conflicts
        // .layer(CorsLayer::permissive())
        // .layer(TraceLayer::new_for_http())
}

async fn health_handler() -> Result<Json<HealthCheck>, StatusCode> {
    let health_check = HealthCheck {
        status: HealthStatus::Healthy,
        version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: Utc::now(),
    };

    Ok(Json(health_check))
}

// Validation helper functions
fn validate_username(username: &str) -> Result<String, AppError> {
    let trimmed = username.trim();
    if trimmed.is_empty() {
        return Err(AppError {
            message: "Username cannot be empty".to_string(),
            status_code: StatusCode::BAD_REQUEST,
        });
    }
    if trimmed.len() > 50 {
        return Err(AppError {
            message: "Username cannot be longer than 50 characters".to_string(),
            status_code: StatusCode::BAD_REQUEST,
        });
    }
    Ok(trimmed.to_string())
}

fn validate_message_text(message_text: &str) -> Result<String, AppError> {
    let trimmed = message_text.trim();
    if trimmed.is_empty() {
        return Err(AppError {
            message: "Message text cannot be empty".to_string(),
            status_code: StatusCode::BAD_REQUEST,
        });
    }
    if trimmed.len() > 500 {
        return Err(AppError {
            message: "Message text cannot be longer than 500 characters".to_string(),
            status_code: StatusCode::BAD_REQUEST,
        });
    }
    Ok(trimmed.to_string())
}

fn validate_room_id(room_id: &str) -> Result<String, AppError> {
    let trimmed = room_id.trim();
    if trimmed.is_empty() {
        return Err(AppError {
            message: "Room ID cannot be empty".to_string(),
            status_code: StatusCode::BAD_REQUEST,
        });
    }
    // Normalize to lowercase for consistency
    Ok(trimmed.to_lowercase())
}

// Helper function to ensure room exists, creating it if necessary
async fn ensure_room_exists(
    ddb: &DynamoDbClient,
    rooms_table: &str,
    room_id: &str,
) -> Result<(), AppError> {
    let get_item_result = ddb
        .get_item()
        .table_name(rooms_table)
        .key("id", AttributeValue::S(room_id.to_string()))
        .send()
        .await;

    match get_item_result {
        Ok(output) => {
            if output.item.is_none() {
                // Room doesn't exist, create it
                let now = Utc::now();
                let room_name = if room_id == "general" {
                    "General".to_string()
                } else {
                    room_id.to_string()
                };

                let mut item = HashMap::new();
                item.insert("id".to_string(), AttributeValue::S(room_id.to_string()));
                item.insert("name".to_string(), AttributeValue::S(room_name));
                item.insert("created_at_iso".to_string(), AttributeValue::S(now.to_rfc3339()));
                item.insert("created_at_epoch".to_string(), AttributeValue::N(now.timestamp().to_string()));

                ddb
                    .put_item()
                    .table_name(rooms_table)
                    .set_item(Some(item))
                    .condition_expression("attribute_not_exists(id)")
                    .send()
                    .await
                    .map_err(|e| {
                        tracing::warn!("Failed to create room {}: {:?}", room_id, e);
                        // Even if room creation fails due to race condition, that's OK
                        AppError::from_error(e)
                    })?;

                tracing::info!("Created new room: {}", room_id);
            }
            Ok(())
        }
        Err(e) => Err(AppError::from_error(e))
    }
}

// POST /chat/messages - Send a new message
async fn post_message_handler(
    State(state): State<AppState>,
    Json(request): Json<SendMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!("Received message request for room: {}", request.room_id);

    // Validate input
    let room_id = validate_room_id(&request.room_id)?;
    let username = validate_username(&request.username)?;
    let message_text = validate_message_text(&request.message_text)?;

    // Ensure room exists
    ensure_room_exists(&state.ddb, &state.rooms_table, &room_id).await?;

    // Create message
    let now = Utc::now();
    let message_id = Uuid::new_v4().to_string();
    let timestamp_millis = now.timestamp_millis();

    let mut item = HashMap::new();
    item.insert("id".to_string(), AttributeValue::S(message_id.clone()));
    item.insert("room_id".to_string(), AttributeValue::S(room_id.clone()));
    item.insert("username".to_string(), AttributeValue::S(username.clone()));
    item.insert("message_text".to_string(), AttributeValue::S(message_text.clone()));
    item.insert("ts".to_string(), AttributeValue::N(timestamp_millis.to_string()));
    item.insert("created_at_iso".to_string(), AttributeValue::S(now.to_rfc3339()));

    // Store message in DynamoDB
    state.ddb
        .put_item()
        .table_name(&state.messages_table)
        .set_item(Some(item))
        .send()
        .await
        .map_err(AppError::from_error)?;

    tracing::info!("Stored message {} in room {}", message_id, room_id);
    
    // Emit metrics for REST message post
    state.metrics.emit_message_sent(&room_id, message_text.len()).await;

    // Create response message
    let message = ChatMessage {
        id: message_id.clone(),
        room_id: room_id.clone(),
        username: username.clone(),
        message_text: message_text.clone(),
        created_at: now,
    };

    Ok((StatusCode::CREATED, Json(message)))
}

// GET /chat/messages/:room_id - Retrieve last 25 messages
async fn get_messages_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!("Retrieving messages for room: {}", room_id);

    let room_id = validate_room_id(&room_id)?;

    // Query messages from DynamoDB
    let result = state.ddb
        .query()
        .table_name(&state.messages_table)
        .key_condition_expression("room_id = :room_id")
        .expression_attribute_values(":room_id", AttributeValue::S(room_id.clone()))
        .scan_index_forward(false) // Most recent first
        .limit(25)
        .send()
        .await
        .map_err(AppError::from_error)?;

    let messages: Vec<ChatMessage> = result.items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            // Convert DynamoDB item to ChatMessage struct
            let id = item.get("id")?.as_s().ok()?.clone();
            let username = item.get("username")?.as_s().ok()?.clone();
            let message_text = item.get("message_text")?.as_s().ok()?.clone();
            let ts = item.get("ts")?.as_n().ok()?.parse::<i64>().ok()?;
            let created_at = chrono::DateTime::from_timestamp_millis(ts)?;

            Some(ChatMessage {
                id,
                room_id: room_id.clone(),
                username,
                message_text,
                created_at: created_at.with_timezone(&Utc),
            })
        })
        .collect();

    tracing::info!("Retrieved {} messages for room {}", messages.len(), room_id);

    let response = GetMessagesResponse {
        room_id,
        messages,
    };

    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Method, Request, StatusCode},
    };
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
            rooms_table: "test-rooms".to_string(),
            messages_table: "test-messages".to_string(),
            metrics,
        };
        
        let app = create_app(state);

        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::GET)
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        // TODO: Add body deserialization test when body collection is fixed
    }
}
