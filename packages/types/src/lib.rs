use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

// Health Check Types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct HealthCheck {
    pub status: HealthStatus,
    pub version: String,
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq)]
#[ts(export)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

// Chat Types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Message {
    pub id: String, // ULID - unique message identifier
    #[ts(rename = "userId")]
    pub user_id: String, // ULID - sender's unique identifier
    pub username: String, // Display name of the sender
    pub text: String, // Message content
    pub timestamp: DateTime<Utc>, // When the message was sent
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatMessage {
    pub id: String,
    pub room_id: String,
    #[ts(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub message_text: String,
    pub created_at: DateTime<Utc>,
    #[ts(rename = "clientMessageId")]
    pub client_message_id: Option<String>,
}

// Legacy room-based API types (keep for backward compatibility)
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SendMessageRequest {
    pub room_id: String,
    #[ts(rename = "userId")]
    pub user_id: String,
    pub username: String,
    pub message_text: String,
    #[ts(rename = "clientMessageId")]
    pub client_message_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GetMessagesResponse {
    pub room_id: String,
    pub messages: Vec<ChatMessage>,
}

// New frontend-expected API types
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SendMessageApiRequest {
    #[ts(rename = "userId")]
    pub user_id: String, // ULID - sender's unique identifier
    pub username: String, // Display name of the sender
    pub text: String,     // Message content
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<Message>,
    pub messages: Option<Vec<Message>>,
    pub error: Option<String>,
    pub code: Option<String>,
}

// Export types for easy access - removed redundant pub use since types are already defined in this module

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_check() {
        let health = HealthCheck {
            status: HealthStatus::Healthy,
            version: "0.1.0".to_string(),
            timestamp: Utc::now(),
        };

        assert_eq!(health.status, HealthStatus::Healthy);
        assert_eq!(health.version, "0.1.0");
    }

    #[test]
    fn test_message_serialization() {
        let message = Message {
            id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
            user_id: "01ARZ3NDEKTSV4RRFFQ69G5FB1".to_string(),
            username: "alice".to_string(),
            text: "Hello world!".to_string(),
            timestamp: Utc::now(),
        };

        let json = serde_json::to_string(&message).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();

        assert_eq!(message.id, deserialized.id);
        assert_eq!(message.user_id, deserialized.user_id);
        assert_eq!(message.username, deserialized.username);
        assert_eq!(message.text, deserialized.text);
    }

    #[test]
    fn test_send_message_request_validation() {
        let request = SendMessageRequest {
            room_id: "general".to_string(),
            user_id: "01ARZ3NDEKTSV4RRFFQ69G5FB1".to_string(),
            username: "alice".to_string(),
            message_text: "Hello!".to_string(),
            client_message_id: Some("01ARZ3NDEKTSV4RRFFQ69G5FB2".to_string()),
        };

        let json = serde_json::to_string(&request).unwrap();
        let deserialized: SendMessageRequest = serde_json::from_str(&json).unwrap();

        assert_eq!(request.room_id, deserialized.room_id);
        assert_eq!(request.user_id, deserialized.user_id);
        assert_eq!(request.username, deserialized.username);
        assert_eq!(request.message_text, deserialized.message_text);
        assert_eq!(request.client_message_id, deserialized.client_message_id);
    }

    #[test]
    fn test_get_messages_response() {
        let messages = vec![
            ChatMessage {
                id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".to_string(),
                room_id: "general".to_string(),
                user_id: "01ARZ3NDEKTSV4RRFFQ69G5FB1".to_string(),
                username: "alice".to_string(),
                message_text: "Hello!".to_string(),
                created_at: Utc::now(),
                client_message_id: None,
            },
            ChatMessage {
                id: "01ARZ3NDEKTSV4RRFFQ69G5FB2".to_string(),
                room_id: "general".to_string(),
                user_id: "01ARZ3NDEKTSV4RRFFQ69G5FB3".to_string(),
                username: "bob".to_string(),
                message_text: "Hi Alice!".to_string(),
                created_at: Utc::now(),
                client_message_id: None,
            },
        ];

        let response = GetMessagesResponse {
            room_id: "general".to_string(),
            messages,
        };

        let json = serde_json::to_string(&response).unwrap();
        let deserialized: GetMessagesResponse = serde_json::from_str(&json).unwrap();

        assert_eq!(response.room_id, deserialized.room_id);
        assert_eq!(response.messages.len(), deserialized.messages.len());
        assert_eq!(response.messages[0].username, "alice");
        assert_eq!(response.messages[1].username, "bob");
    }
}
