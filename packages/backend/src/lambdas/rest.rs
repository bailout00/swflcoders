use aws_sdk_dynamodb::Client as DynamoDbClient;
use lambda_http::{run, service_fn, Body, Error, Request, Response};
use std::sync::LazyLock;
use tracing::{debug, error, info, warn, Level};
use types::SendMessageRequest;

use backend::handlers;

// Tables configuration
static TABLES: LazyLock<handlers::Tables> = LazyLock::new(|| handlers::Tables::from_env());

async fn handler(event: Request) -> Result<Response<Body>, Error> {
    let method = event.method().as_str();
    let path = event.uri().path();

    info!("Lambda handler called: {} {}", method, path);
    debug!("Full request: {:?}", event);

    let aws_config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let ddb = DynamoDbClient::new(&aws_config);
    let tables = TABLES.clone();

    info!("Handler processing: {} {}", method, path);

    // Strip stage prefix from path if present (e.g., /beta/chat/messages/general -> /chat/messages/general)
    let clean_path = if let Some(stripped) =
        path.strip_prefix("/").and_then(|p| p.split_once("/").map(|(_, rest)| rest))
    {
        format!("/{}", stripped)
    } else {
        path.to_string()
    };

    info!("Cleaned path: {}", clean_path);

    match (method, clean_path.as_str()) {
        ("GET", "/health") => {
            info!("Processing health endpoint");
            match handlers::health_handler().await {
                Ok(health_check) => {
                    let body = serde_json::to_string(&health_check)?;
                    Ok(Response::builder()
                        .status(200)
                        .header("content-type", "application/json")
                        .body(Body::Text(body))
                        .unwrap())
                }
                Err(err) => {
                    error!("Health check failed: {}", err);
                    Ok(Response::builder()
                        .status(500)
                        .body(Body::Text("Internal server error".to_string()))
                        .unwrap())
                }
            }
        }
        ("POST", "/chat/messages") => {
            info!("Processing POST /chat/messages");
            let bytes = event.body().as_ref().to_owned();
            let request: SendMessageRequest = serde_json::from_slice(&bytes)?;

            match handlers::post_message_handler(&ddb, &tables, request).await {
                Ok(message) => {
                    let body = serde_json::to_string(&message)?;
                    Ok(Response::builder()
                        .status(201)
                        .header("content-type", "application/json")
                        .body(Body::Text(body))
                        .unwrap())
                }
                Err(err) => {
                    error!("Failed to post message: {}", err);
                    Ok(Response::builder()
                        .status(500)
                        .body(Body::Text("Internal server error".to_string()))
                        .unwrap())
                }
            }
        }
        ("GET", path) if path.starts_with("/chat/messages/") => {
            info!("Processing GET messages for path: {}", path);
            let room_id = path.trim_start_matches("/chat/messages/").to_string();
            info!("Extracted room_id: {}", room_id);

            match handlers::get_messages_handler(&ddb, &tables, room_id).await {
                Ok(response) => {
                    let body = serde_json::to_string(&response)?;
                    Ok(Response::builder()
                        .status(200)
                        .header("content-type", "application/json")
                        .body(Body::Text(body))
                        .unwrap())
                }
                Err(err) => {
                    error!("Failed to get messages: {}", err);
                    Ok(Response::builder()
                        .status(500)
                        .body(Body::Text("Internal server error".to_string()))
                        .unwrap())
                }
            }
        }
        _ => {
            warn!("No route matched for: {} {}", method, path);
            Ok(Response::builder().status(404).body(Body::Empty).unwrap())
        }
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_max_level(Level::DEBUG)
        .json()
        .flatten_event(true)
        .with_current_span(false)
        .with_span_list(false)
        .init();
    run(service_fn(handler)).await
}
