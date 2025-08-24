use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use aws_sdk_dynamodb::{Client as DynamoDbClient, types::AttributeValue};
use aws_sdk_apigatewaymanagement::{Client as ApiGatewayClient, primitives::Blob};
use std::{collections::HashMap, env};
use tracing::{info, error};
use chrono::{DateTime, Utc};
use backend::MetricsHelper;

#[derive(Deserialize)]
struct DynamoDBStreamEvent {
    #[serde(rename = "Records")]
    records: Vec<DynamoDBRecord>,
}

#[derive(Deserialize)]
struct DynamoDBRecord {
    #[serde(rename = "eventName")]
    event_name: String,
    dynamodb: Option<DynamoDBStreamRecord>,
}

#[derive(Deserialize)]
struct DynamoDBStreamRecord {
    #[serde(rename = "NewImage")]
    new_image: Option<HashMap<String, AttributeValueWrapper>>,
}

#[derive(Deserialize)]
struct AttributeValueWrapper {
    #[serde(rename = "S")]
    s: Option<String>,
    #[serde(rename = "N")]
    n: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    id: String,
    room_id: String,
    username: String,
    message_text: String,
    created_at: String,
}

#[derive(Serialize)]
struct LambdaResponse {
    #[serde(rename = "statusCode")]
    status_code: i32,
}

async fn function_handler(event: LambdaEvent<DynamoDBStreamEvent>) -> Result<LambdaResponse, Error> {
    let (event, _context) = event.into_parts();
    
    info!("DynamoDB Stream event with {} records", event.records.len());

    // Initialize AWS clients
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let ddb = DynamoDbClient::new(&aws_config);

    // Build WebSocket management client
    let ws_api_id = env::var("WS_API_ID")
        .map_err(|_| "WS_API_ID environment variable not set")?;
    let ws_stage = env::var("WS_STAGE")
        .map_err(|_| "WS_STAGE environment variable not set")?;
    let aws_region = env::var("AWS_REGION")
        .map_err(|_| "AWS_REGION environment variable not set")?;

    let ws_endpoint = format!("https://{}.execute-api.{}.amazonaws.com/{}", ws_api_id, aws_region, ws_stage);
    let api_gateway_config = aws_sdk_apigatewaymanagement::config::Builder::from(&aws_config)
        .endpoint_url(ws_endpoint)
        .build();
    let api_gateway = ApiGatewayClient::from_conf(api_gateway_config);

    let connections_table = env::var("CONNECTIONS_TABLE")
        .map_err(|_| "CONNECTIONS_TABLE environment variable not set")?;

    for record in event.records {
        if let Err(e) = process_record(&ddb, &api_gateway, &connections_table, record).await {
            error!("Failed to process record: {:?}", e);
            // Continue processing other records even if one fails
        }
    }

    Ok(LambdaResponse { status_code: 200 })
}

async fn process_record(
    ddb: &DynamoDbClient,
    api_gateway: &ApiGatewayClient,
    connections_table: &str,
    record: DynamoDBRecord,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize metrics helper
    let metrics = MetricsHelper::new().await;
    // Only process INSERT events (new messages)
    if record.event_name != "INSERT" {
        info!("Skipping event: {}", record.event_name);
        return Ok(());
    }

    let stream_record = record.dynamodb.ok_or("No dynamodb data in record")?;
    let image = stream_record.new_image.ok_or("No NewImage in record")?;

    // Extract message data from DynamoDB stream record
    let room_id = image.get("room_id")
        .and_then(|v| v.s.as_ref())
        .ok_or("Missing room_id")?;
    let message_id = image.get("id")
        .and_then(|v| v.s.as_ref())
        .ok_or("Missing id")?;
    let username = image.get("username")
        .and_then(|v| v.s.as_ref())
        .ok_or("Missing username")?;
    let message_text = image.get("message_text")
        .and_then(|v| v.s.as_ref())
        .ok_or("Missing message_text")?;
    let ts = image.get("ts")
        .and_then(|v| v.n.as_ref())
        .and_then(|n| n.parse::<i64>().ok())
        .ok_or("Missing or invalid ts")?;

    // Create the message payload to broadcast
    let message_payload = ChatMessage {
        id: message_id.clone(),
        room_id: room_id.clone(),
        username: username.clone(),
        message_text: message_text.clone(),
        created_at: DateTime::from_timestamp_millis(ts)
            .unwrap_or_else(|| Utc::now())
            .to_rfc3339(),
    };

    info!("Broadcasting message to room {}: {:?}", room_id, message_payload);

    // Query for all connections in this room using GSI
    let connections_result = ddb.query()
        .table_name(connections_table)
        .index_name("room-index")
        .key_condition_expression("room_id = :room_id")
        .expression_attribute_values(":room_id", AttributeValue::S(room_id.clone()))
        .send()
        .await?;

    let connections = connections_result.items.unwrap_or_default();
    info!("Found {} connections in room {}", connections.len(), room_id);

    // Broadcast to each connection and track metrics
    let message_json = serde_json::to_string(&message_payload)?;
    let message_blob = Blob::new(message_json.as_bytes());
    
    let total_connections = connections.len() as i32;
    let mut successful_sends = 0;
    
    // Emit message sent metrics
    metrics.emit_message_sent(room_id, message_text.len()).await;

    for connection in connections {
        if let Some(AttributeValue::S(connection_id)) = connection.get("connection_id") {
            match api_gateway.post_to_connection()
                .connection_id(connection_id)
                .data(message_blob.clone())
                .send()
                .await
            {
                Ok(_) => {
                    info!("Successfully sent message to connection {}", connection_id);
                    successful_sends += 1;
                }
                Err(e) => {
                    error!("Failed to send message to connection {}: {:?}", connection_id, e);
                    
                    // If connection is stale (410 Gone), remove it from our table
                    if let Some(service_err) = e.as_service_error() {
                        if service_err.is_gone_exception() {
                            info!("Removing stale connection {}", connection_id);
                            if let Err(delete_err) = ddb.delete_item()
                                .table_name(connections_table)
                                .key("connection_id", AttributeValue::S(connection_id.clone()))
                                .send()
                                .await
                            {
                                error!("Failed to delete stale connection {}: {:?}", connection_id, delete_err);
                            }
                        }
                    }
                }
            }
        }
    }
    
    // Emit broadcast metrics
    metrics.emit_message_broadcast(room_id, total_connections, successful_sends).await;

    info!("Finished broadcasting message {} to room {}", message_id, room_id);
    Ok(())
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
