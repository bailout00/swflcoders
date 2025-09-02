#!/bin/bash
# Development script to run the backend locally with deployed AWS resources

# Set environment variables for deployed DynamoDB tables
export CHAT_ROOMS_TABLE="chat-rooms"
export CHAT_MESSAGES_TABLE="chat-messages"
export CONNECTIONS_TABLE="chat-connections"
export AWS_REGION="us-east-1"
export AWS_PROFILE="sb-beta"

# Optional: Set stage for metrics
export STAGE="beta"

# Optional: Public URL for local broadcast fan-out
# If you expose your local server (port 3001) via a tunnel (e.g., ngrok, Cloudflare Tunnel),
# set DEV_BROADCAST_URL to that public base URL so the AWS broadcast Lambda can call back:
#   export DEV_BROADCAST_URL="https://<your-tunnel-domain>"
# Leaving it unset means the Lambda will use API Gateway Management API as usual.
export DEV_BROADCAST_URL=${DEV_BROADCAST_URL:-}

echo "🚀 Starting backend with deployed AWS resources..."
echo "📊 DynamoDB Tables:"
echo "   - Rooms: $CHAT_ROOMS_TABLE"
echo "   - Messages: $CHAT_MESSAGES_TABLE"
echo "   - Connections: $CONNECTIONS_TABLE"
echo "🌐 Region: $AWS_REGION"
echo "👤 Profile: $AWS_PROFILE"
if [ -n "$DEV_BROADCAST_URL" ]; then
  echo "🔁 Dev Broadcast URL: $DEV_BROADCAST_URL (Lambda will POST /dev/broadcast here)"
else
  echo "🔁 Dev Broadcast URL: (unset) — Lambda will use API Gateway Management API"
fi
echo ""

# Run the backend with dev feature for local WS fan-out
cargo run --features dev --bin backend
