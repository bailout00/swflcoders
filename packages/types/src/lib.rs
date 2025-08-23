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
    pub id: String,
    pub room_id: String,
    pub username: String,
    pub message_text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ChatMessage {
    pub id: String,
    pub room_id: String,
    pub username: String,
    pub message_text: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SendMessageRequest {
    pub room_id: String,
    pub username: String,
    pub message_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GetMessagesResponse {
    pub room_id: String,
    pub messages: Vec<Message>,
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
            id: "msg123".to_string(),
            room_id: "general".to_string(),
            username: "alice".to_string(),
            message_text: "Hello world!".to_string(),
            created_at: Utc::now(),
        };
        
        let json = serde_json::to_string(&message).unwrap();
        let deserialized: Message = serde_json::from_str(&json).unwrap();
        
        assert_eq!(message.id, deserialized.id);
        assert_eq!(message.room_id, deserialized.room_id);
        assert_eq!(message.username, deserialized.username);
        assert_eq!(message.message_text, deserialized.message_text);
    }

    #[test]
    fn test_send_message_request_validation() {
        let request = SendMessageRequest {
            room_id: "general".to_string(),
            username: "alice".to_string(),
            message_text: "Hello!".to_string(),
        };
        
        let json = serde_json::to_string(&request).unwrap();
        let deserialized: SendMessageRequest = serde_json::from_str(&json).unwrap();
        
        assert_eq!(request.room_id, deserialized.room_id);
        assert_eq!(request.username, deserialized.username);
        assert_eq!(request.message_text, deserialized.message_text);
    }

    #[test]
    fn test_get_messages_response() {
        let messages = vec![
            Message {
                id: "msg1".to_string(),
                room_id: "general".to_string(),
                username: "alice".to_string(),
                message_text: "Hello!".to_string(),
                created_at: Utc::now(),
            },
            Message {
                id: "msg2".to_string(),
                room_id: "general".to_string(),
                username: "bob".to_string(),
                message_text: "Hi Alice!".to_string(),
                created_at: Utc::now(),
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
