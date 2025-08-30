#!/bin/bash
# Development script to run the backend locally with deployed AWS resources

# Set environment variables for deployed DynamoDB tables
export CHAT_ROOMS_TABLE="chat-rooms-beta"
export CHAT_MESSAGES_TABLE="chat-messages-beta"
export CONNECTIONS_TABLE="chat-connections-beta"
export AWS_REGION="us-east-1"
export AWS_PROFILE="sb-beta"

# Optional: Set stage for metrics
export STAGE="beta"

echo "🚀 Starting backend with deployed AWS resources..."
echo "📊 DynamoDB Tables:"
echo "   - Rooms: $CHAT_ROOMS_TABLE"
echo "   - Messages: $CHAT_MESSAGES_TABLE"
echo "   - Connections: $CONNECTIONS_TABLE"
echo "🌐 Region: $AWS_REGION"
echo "👤 Profile: $AWS_PROFILE"
echo ""

# Run the backend
cargo run --bin backend
