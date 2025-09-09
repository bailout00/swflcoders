use aws_sdk_dynamodb::{types::AttributeValue, Client as DynamoDbClient};
use backend::MetricsHelper;
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, sync::LazyLock};
use tracing::{error, info};

// Static constant for required environment variable - will panic at startup if not set
static CONNECTIONS_TABLE: LazyLock<String> = LazyLock::new(|| {
    env::var("CONNECTIONS_TABLE").expect("CONNECTIONS_TABLE environment variable must be set")
});

#[derive(Debug, Deserialize, Serialize)]
struct WebSocketEvent {
    #[serde(rename = "requestContext")]
    request_context: RequestContext,
    #[serde(rename = "queryStringParameters")]
    query_string_parameters: Option<HashMap<String, String>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct RequestContext {
    #[serde(rename = "connectionId")]
    connection_id: String,
    #[serde(rename = "domainName")]
    domain_name: Option<String>,
    stage: Option<String>,
}

#[derive(Serialize)]
struct LambdaResponse {
    #[serde(rename = "statusCode")]
    status_code: i32,
}

async fn function_handler(event: LambdaEvent<WebSocketEvent>) -> Result<LambdaResponse, Error> {
    let (event, _context) = event.into_parts();

    info!("WebSocket connection event: {:?}", event);

    // Initialize AWS config, DynamoDB client, and metrics helper
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let ddb = DynamoDbClient::new(&aws_config);
    let metrics = MetricsHelper::new().await;

    let connection_id = &event.request_context.connection_id;
    let domain_name = event.request_context.domain_name.as_deref().unwrap_or("unknown");
    let stage = event.request_context.stage.as_deref().unwrap_or("unknown");

    // Extract query parameters with defaults
    let room_id = event
        .query_string_parameters
        .as_ref()
        .and_then(|params| params.get("room_id"))
        .map(|s| s.as_str())
        .unwrap_or("general");

    let username = event
        .query_string_parameters
        .as_ref()
        .and_then(|params| params.get("username"))
        .map(|s| s.as_str())
        .unwrap_or("anon");

    let user_id = event
        .query_string_parameters
        .as_ref()
        .and_then(|params| params.get("userId"))
        .map(|s| s.as_str())
        .unwrap_or("anon");

    let now = chrono::Utc::now().timestamp_millis();
    let ttl = now / 1000 + (60 * 60 * 24); // 24 hours from now

    info!(
        "Connecting user '{}' to room '{}' with connectionId: {}",
        username, room_id, connection_id
    );

    // Store connection in DynamoDB using static constant
    let connections_table = &*CONNECTIONS_TABLE;

    let mut item = HashMap::new();
    item.insert("connection_id".to_string(), AttributeValue::S(connection_id.clone()));
    item.insert("room_id".to_string(), AttributeValue::S(room_id.to_string()));
    item.insert("user_id".to_string(), AttributeValue::S(user_id.to_string())); // Store user_id
    item.insert("username".to_string(), AttributeValue::S(username.to_string()));
    item.insert("connected_at".to_string(), AttributeValue::N(now.to_string()));
    item.insert("domain".to_string(), AttributeValue::S(domain_name.to_string()));
    item.insert("stage".to_string(), AttributeValue::S(stage.to_string()));
    // Explicitly mark transport for broadcaster
    item.insert("transport".to_string(), AttributeValue::S("apigw".to_string()));
    item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));

    match ddb.put_item().table_name(connections_table).set_item(Some(item)).send().await {
        Ok(_) => {
            info!(
                "Successfully stored connection {} for user {} in room {}",
                connection_id, username, room_id
            );

            // Emit connection metrics
            metrics.emit_connection_event("connect", room_id, None).await;

            Ok(LambdaResponse { status_code: 200 })
        }
        Err(e) => {
            error!("Failed to store connection: {:?}", e);

            // Emit error metric
            let mut dimensions = HashMap::new();
            dimensions.insert("ErrorType".to_string(), "DatabaseError".to_string());
            dimensions.insert("RoomId".to_string(), room_id.to_string());
            metrics.emit_count("ConnectionErrors", 1.0, Some(dimensions)).await;

            Ok(LambdaResponse { status_code: 500 })
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    // Initialize tracing with JSON format for CloudWatch
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .init();

    run(service_fn(function_handler)).await
}
