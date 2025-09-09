use aws_sdk_apigatewaymanagement::{primitives::Blob, Client as ApiGatewayClient};
use aws_sdk_dynamodb::{types::AttributeValue, Client as DynamoDbClient};
use backend::MetricsHelper;
use chrono::{DateTime, Utc};
use lambda_runtime::{run, service_fn, Error, LambdaEvent};
#[cfg(feature = "dev")]
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, sync::LazyLock};
use tracing::{error, info};

// Static constants for required environment variables - will panic at startup if not set
static CONNECTIONS_TABLE: LazyLock<String> = LazyLock::new(|| {
    env::var("CONNECTIONS_TABLE").expect("CONNECTIONS_TABLE environment variable must be set")
});

static WS_API_ID: LazyLock<String> =
    LazyLock::new(|| env::var("WS_API_ID").expect("WS_API_ID environment variable must be set"));

static WS_STAGE: LazyLock<String> =
    LazyLock::new(|| env::var("WS_STAGE").expect("WS_STAGE environment variable must be set"));

static AWS_REGION: LazyLock<String> =
    LazyLock::new(|| env::var("AWS_REGION").expect("AWS_REGION environment variable must be set"));

// Optional: when set, broadcast locally via HTTP to the dev server
#[cfg(feature = "dev")]
static DEV_BROADCAST_URL: LazyLock<Option<String>> =
    LazyLock::new(|| env::var("DEV_BROADCAST_URL").ok());

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
    user_id: String,
    username: String,
    message_text: String,
    created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    client_message_id: Option<String>,
}

#[derive(Serialize)]
struct LambdaResponse {
    #[serde(rename = "statusCode")]
    status_code: i32,
}

async fn function_handler(
    event: LambdaEvent<DynamoDBStreamEvent>,
) -> Result<LambdaResponse, Error> {
    let (event, _context) = event.into_parts();

    info!("DynamoDB Stream event with {} records", event.records.len());

    // Initialize AWS clients
    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let ddb = DynamoDbClient::new(&aws_config);

    // Optional HTTP client for dev per-connection push
    #[cfg(feature = "dev")]
    let http_client = HttpClient::new();

    // Build WebSocket management client using static constants for prod
    let ws_endpoint = format!(
        "https://{}.execute-api.{}.amazonaws.com/{}",
        &*WS_API_ID, &*AWS_REGION, &*WS_STAGE
    );
    let api_gateway_config = aws_sdk_apigatewaymanagement::config::Builder::from(&aws_config)
        .endpoint_url(ws_endpoint)
        .build();
    let api_gateway = ApiGatewayClient::from_conf(api_gateway_config);

    for record in event.records {
        if let Err(e) = process_record(&ddb, &api_gateway, &CONNECTIONS_TABLE, record).await {
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
    let room_id = image.get("room_id").and_then(|v| v.s.as_ref()).ok_or("Missing room_id")?;
    let message_id = image.get("id").and_then(|v| v.s.as_ref()).ok_or("Missing id")?;
    let username = image.get("username").and_then(|v| v.s.as_ref()).ok_or("Missing username")?;
    let message_text =
        image.get("message_text").and_then(|v| v.s.as_ref()).ok_or("Missing message_text")?;
    let ts = image
        .get("ts")
        .and_then(|v| v.n.as_ref())
        .and_then(|n| n.parse::<i64>().ok())
        .ok_or("Missing or invalid ts")?;

    // Extract user_id and client_message_id (may be missing for older messages)
    let user_id = image
        .get("user_id")
        .and_then(|v| v.s.as_ref())
        .map(|s| s.to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let client_message_id = image.get("client_message_id").and_then(|v| v.s.as_ref()).cloned();

    // Create the message payload to broadcast
    let message_payload = ChatMessage {
        id: message_id.clone(),
        room_id: room_id.clone(),
        user_id,
        username: username.clone(),
        message_text: message_text.clone(),
        created_at: DateTime::from_timestamp_millis(ts).unwrap_or_else(Utc::now).to_rfc3339(),
        client_message_id,
    };

    info!("Broadcasting message to room {}: {:?}", room_id, message_payload);

    // Query for all connections in this room using GSI
    let connections_result = ddb
        .query()
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

    // Send per connection according to its transport
    for connection in connections {
        // Determine transport; default to apigw if missing
        let transport = connection
            .get("transport")
            .and_then(|v| v.as_s().ok())
            .map(|s| s.as_str())
            .unwrap_or("apigw");

        match transport {
            "apigw" => {
                if let Some(AttributeValue::S(connection_id)) = connection.get("connection_id") {
                    match api_gateway
                        .post_to_connection()
                        .connection_id(connection_id)
                        .data(message_blob.clone())
                        .send()
                        .await
                    {
                        Ok(_) => {
                            info!("Sent via API Gateway to connection {}", connection_id);
                            successful_sends += 1;
                        }
                        Err(e) => {
                            error!("Failed to send via API Gateway to {}: {:?}", connection_id, e);
                            if let Some(service_err) = e.as_service_error() {
                                if service_err.is_gone_exception() {
                                    info!("Removing stale connection {}", connection_id);
                                    if let Err(delete_err) = ddb
                                        .delete_item()
                                        .table_name(connections_table)
                                        .key(
                                            "connection_id",
                                            AttributeValue::S(connection_id.clone()),
                                        )
                                        .send()
                                        .await
                                    {
                                        error!(
                                            "Failed to delete stale connection {}: {:?}",
                                            connection_id, delete_err
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
            #[cfg(feature = "dev")]
            "dev" => {
                // Use per-connection push_url
                if let Some(AttributeValue::S(push_url)) = connection.get("push_url") {
                    match http_client.post(push_url).json(&message_payload).send().await {
                        Ok(resp) => {
                            if resp.status().is_success() {
                                info!("Sent via dev push_url to {}", push_url);
                                successful_sends += 1;
                            } else if resp.status().as_u16() == 404 || resp.status().as_u16() == 410
                            {
                                // Remove stale connection
                                if let Some(AttributeValue::S(connection_id)) =
                                    connection.get("connection_id")
                                {
                                    let _ = ddb
                                        .delete_item()
                                        .table_name(connections_table)
                                        .key(
                                            "connection_id",
                                            AttributeValue::S(connection_id.clone()),
                                        )
                                        .send()
                                        .await;
                                }
                            } else {
                                error!("Dev push_url responded with status {}", resp.status());
                            }
                        }
                        Err(e) => {
                            error!("HTTP error sending to dev push_url {}: {:?}", push_url, e);
                        }
                    }
                } else {
                    error!("Missing push_url for dev transport connection");
                }
            }
            _ => {
                // Unknown transport; skip
                info!("Skipping connection with unknown transport: {}", transport);
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
    // Initialize tracing with JSON format for CloudWatch
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .json()
        .with_current_span(false)
        .with_span_list(false)
        .init();

    run(service_fn(function_handler)).await
}
