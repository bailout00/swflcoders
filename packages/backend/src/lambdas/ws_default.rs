use lambda_runtime::{run, service_fn, Error, LambdaEvent};
use serde::{Deserialize, Serialize};
use tracing::info;

#[derive(Debug, Deserialize, Serialize)]
struct WebSocketEvent {
    #[serde(rename = "requestContext")]
    request_context: RequestContext,
    body: Option<String>,
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

    let connection_id = &event.request_context.connection_id;
    let body = event.body.as_deref().unwrap_or("");

    info!("WebSocket default route - connectionId: {}, message: {}", connection_id, body);

    // For now, this is a no-op handler that just logs the message
    // In the future, this could handle specific message types or echo back

    Ok(LambdaResponse { status_code: 200 })
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
