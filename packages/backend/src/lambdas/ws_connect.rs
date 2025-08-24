use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use aws_sdk_dynamodb::{Client as DynamoDbClient, types::AttributeValue};
use std::{collections::HashMap, env};
use tracing::{info, error};
use backend::MetricsHelper;

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
    let room_id = event.query_string_parameters
        .as_ref()
        .and_then(|params| params.get("room_id"))
        .map(|s| s.as_str())
        .unwrap_or("general");
    
    let username = event.query_string_parameters
        .as_ref()
        .and_then(|params| params.get("username"))
        .map(|s| s.as_str())
        .unwrap_or("anon");

    let now = chrono::Utc::now().timestamp_millis();
    let ttl = now / 1000 + (60 * 60 * 24); // 24 hours from now

    info!("Connecting user '{}' to room '{}' with connectionId: {}", username, room_id, connection_id);

    // Store connection in DynamoDB
    let connections_table = env::var("CONNECTIONS_TABLE")
        .map_err(|_| "CONNECTIONS_TABLE environment variable not set")?;

    let mut item = HashMap::new();
    item.insert("connection_id".to_string(), AttributeValue::S(connection_id.clone()));
    item.insert("room_id".to_string(), AttributeValue::S(room_id.to_string()));
    item.insert("username".to_string(), AttributeValue::S(username.to_string()));
    item.insert("connected_at".to_string(), AttributeValue::N(now.to_string()));
    item.insert("domain".to_string(), AttributeValue::S(domain_name.to_string()));
    item.insert("stage".to_string(), AttributeValue::S(stage.to_string()));
    item.insert("ttl".to_string(), AttributeValue::N(ttl.to_string()));

    match ddb.put_item()
        .table_name(connections_table)
        .set_item(Some(item))
        .send()
        .await
    {
        Ok(_) => {
            info!("Successfully stored connection {} for user {} in room {}", connection_id, username, room_id);
            
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
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .without_time()
        .init();

    run(service_fn(function_handler)).await
}
