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
}

#[derive(Debug, Deserialize, Serialize)]
struct RequestContext {
    #[serde(rename = "connectionId")]
    connection_id: String,
}

#[derive(Serialize)]
struct LambdaResponse {
    #[serde(rename = "statusCode")]
    status_code: i32,
}

async fn function_handler(event: LambdaEvent<WebSocketEvent>) -> Result<LambdaResponse, Error> {
    let (event, _context) = event.into_parts();

    info!("WebSocket disconnection event: {:?}", event);

    // Initialize AWS config, DynamoDB client, and metrics helper
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let ddb = DynamoDbClient::new(&aws_config);
    let metrics = MetricsHelper::new().await;

    let connection_id = &event.request_context.connection_id;

    info!("Disconnecting connectionId: {}", connection_id);

    // First, get connection info to extract room_id for metrics
    let mut key = HashMap::new();
    key.insert("connection_id".to_string(), AttributeValue::S(connection_id.clone()));

    let room_id = match ddb
        .get_item()
        .table_name(&*CONNECTIONS_TABLE)
        .set_key(Some(key.clone()))
        .send()
        .await
    {
        Ok(response) => response
            .item
            .as_ref()
            .and_then(|item| item.get("room_id"))
            .and_then(|attr| attr.as_s().ok())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
        Err(_) => "unknown".to_string(),
    };

    // Delete connection from DynamoDB using static constant
    match ddb.delete_item().table_name(&*CONNECTIONS_TABLE).set_key(Some(key)).send().await {
        Ok(_) => {
            info!("Successfully removed connection {}", connection_id);

            // Emit disconnection metrics
            metrics.emit_connection_event("disconnect", &room_id, None).await;

            Ok(LambdaResponse { status_code: 200 })
        }
        Err(e) => {
            error!("Failed to remove connection: {:?}", e);

            // Emit error metric
            let mut dimensions = HashMap::new();
            dimensions.insert("ErrorType".to_string(), "DatabaseError".to_string());
            dimensions.insert("RoomId".to_string(), room_id.clone());
            metrics.emit_count("DisconnectionErrors", 1.0, Some(dimensions)).await;

            // Even if deletion fails, we should return 200 to avoid reconnection loops
            Ok(LambdaResponse { status_code: 200 })
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
