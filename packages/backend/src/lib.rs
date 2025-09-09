use serde_json::json;
use std::{collections::HashMap, env};

pub mod handlers {
    use aws_sdk_dynamodb::{types::AttributeValue, Client as DynamoDbClient};
    use chrono::Utc;
    use std::{collections::HashMap, env};
    use tracing::info;
    use types::{ChatMessage, GetMessagesResponse, HealthCheck, HealthStatus, SendMessageRequest};
    use uuid::Uuid;

    // Table names structure
    #[derive(Clone)]
    pub struct Tables {
        pub rooms: String,
        pub messages: String,
    }

    impl Tables {
        pub fn from_env() -> Self {
            Self {
                rooms: env::var("CHAT_ROOMS_TABLE").expect("CHAT_ROOMS_TABLE must be set"),
                messages: env::var("CHAT_MESSAGES_TABLE").expect("CHAT_MESSAGES_TABLE must be set"),
            }
        }
    }

    // Shared validation functions
    pub fn validate_username(username: &str) -> Result<String, String> {
        let trimmed = username.trim();
        if trimmed.is_empty() {
            return Err("Username cannot be empty".to_string());
        }
        if trimmed.len() > 50 {
            return Err("Username cannot be longer than 50 characters".to_string());
        }
        Ok(trimmed.to_string())
    }

    pub fn validate_message_text(message_text: &str) -> Result<String, String> {
        let trimmed = message_text.trim();
        if trimmed.is_empty() {
            return Err("Message text cannot be empty".to_string());
        }
        if trimmed.len() > 500 {
            return Err("Message text cannot be longer than 500 characters".to_string());
        }
        Ok(trimmed.to_string())
    }

    pub fn validate_room_id(room_id: &str) -> Result<String, String> {
        let trimmed = room_id.trim();
        if trimmed.is_empty() {
            return Err("Room ID cannot be empty".to_string());
        }
        Ok(trimmed.to_lowercase())
    }

    // Shared business logic functions
    pub async fn health_handler() -> Result<HealthCheck, String> {
        let health_check = HealthCheck {
            status: HealthStatus::Healthy,
            version: env!("CARGO_PKG_VERSION").to_string(),
            timestamp: Utc::now(),
        };
        Ok(health_check)
    }

    pub async fn ensure_room_exists(
        ddb: &DynamoDbClient,
        tables: &Tables,
        room_id: &str,
    ) -> Result<(), String> {
        let get_item_result = ddb
            .get_item()
            .table_name(&tables.rooms)
            .key("id", AttributeValue::S(room_id.to_string()))
            .send()
            .await;

        match get_item_result {
            Ok(output) => {
                if output.item.is_none() {
                    // Room doesn't exist, create it
                    let now = Utc::now();
                    let room_name = if room_id == "general" {
                        "General".to_string()
                    } else {
                        room_id.to_string()
                    };

                    let mut item = HashMap::new();
                    item.insert("id".to_string(), AttributeValue::S(room_id.to_string()));
                    item.insert("name".to_string(), AttributeValue::S(room_name));
                    item.insert("created_at_iso".to_string(), AttributeValue::S(now.to_rfc3339()));
                    item.insert(
                        "created_at_epoch".to_string(),
                        AttributeValue::N(now.timestamp().to_string()),
                    );

                    ddb.put_item()
                        .table_name(&tables.rooms)
                        .set_item(Some(item))
                        .condition_expression("attribute_not_exists(id)")
                        .send()
                        .await
                        .map_err(|e| format!("Failed to create room: {:?}", e))?;

                    info!("Created new room: {}", room_id);
                }
                Ok(())
            }
            Err(e) => Err(format!("DynamoDB error: {:?}", e)),
        }
    }

    pub async fn post_message_handler(
        ddb: &DynamoDbClient,
        tables: &Tables,
        request: SendMessageRequest,
    ) -> Result<ChatMessage, String> {
        // Validate input
        let room_id = validate_room_id(&request.room_id)?;
        let user_id = request.user_id.clone();
        let username = validate_username(&request.username)?;
        let message_text = validate_message_text(&request.message_text)?;

        // Ensure room exists
        ensure_room_exists(ddb, tables, &room_id).await?;

        // Create message
        let now = Utc::now();
        let message_id = Uuid::new_v4().to_string();
        let timestamp_millis = now.timestamp_millis();

        let mut item = HashMap::new();
        item.insert("id".to_string(), AttributeValue::S(message_id.clone()));
        item.insert("room_id".to_string(), AttributeValue::S(room_id.clone()));
        item.insert("user_id".to_string(), AttributeValue::S(user_id.clone()));
        item.insert("username".to_string(), AttributeValue::S(username.clone()));
        item.insert("message_text".to_string(), AttributeValue::S(message_text.clone()));
        item.insert("ts".to_string(), AttributeValue::N(timestamp_millis.to_string()));
        item.insert("created_at_iso".to_string(), AttributeValue::S(now.to_rfc3339()));

        // Store client_message_id if provided
        if let Some(client_message_id) = &request.client_message_id {
            item.insert(
                "client_message_id".to_string(),
                AttributeValue::S(client_message_id.clone()),
            );
        }

        // Store message in DynamoDB
        ddb.put_item()
            .table_name(&tables.messages)
            .set_item(Some(item))
            .send()
            .await
            .map_err(|e| format!("DynamoDB error: {:?}", e))?;

        info!("Stored message {} in room {}", message_id, room_id);

        // Create response message
        let message = ChatMessage {
            id: message_id.clone(),
            room_id: room_id.clone(),
            user_id: user_id.clone(),
            username: username.clone(),
            message_text: message_text.clone(),
            created_at: now,
            client_message_id: request.client_message_id.clone(),
        };

        Ok(message)
    }

    pub async fn get_messages_handler(
        ddb: &DynamoDbClient,
        tables: &Tables,
        room_id: String,
    ) -> Result<GetMessagesResponse, String> {
        let room_id = validate_room_id(&room_id)?;

        // Query messages from DynamoDB
        let result = ddb
            .query()
            .table_name(&tables.messages)
            .key_condition_expression("room_id = :room_id")
            .expression_attribute_values(":room_id", AttributeValue::S(room_id.clone()))
            .scan_index_forward(true) // Oldest first
            .limit(25)
            .send()
            .await
            .map_err(|e| format!("DynamoDB error: {:?}", e))?;

        let messages: Vec<ChatMessage> = result
            .items
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                // Convert DynamoDB item to ChatMessage struct
                let id = item.get("id")?.as_s().ok()?.clone();
                let user_id = item
                    .get("user_id")
                    .and_then(|v| v.as_s().ok())
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                let username = item.get("username")?.as_s().ok()?.clone();
                let message_text = item.get("message_text")?.as_s().ok()?.clone();
                let ts = item.get("ts")?.as_n().ok()?.parse::<i64>().ok()?;
                let created_at = chrono::DateTime::from_timestamp_millis(ts)?;
                let client_message_id =
                    item.get("client_message_id").and_then(|v| v.as_s().ok()).cloned();

                Some(ChatMessage {
                    id,
                    room_id: room_id.clone(),
                    user_id,
                    username,
                    message_text,
                    created_at: created_at.with_timezone(&Utc),
                    client_message_id,
                })
            })
            .collect();

        info!("Retrieved {} messages for room {}", messages.len(), room_id);

        let response = GetMessagesResponse { room_id, messages };
        Ok(response)
    }
}

#[derive(Clone)]
pub struct MetricsHelper {
    namespace: String,
    stage: String,
}

impl MetricsHelper {
    pub async fn new() -> Self {
        let stage = env::var("STAGE").unwrap_or_else(|_| "unknown".to_string());
        let namespace = format!("SwflcodersChat/{}", stage);

        Self { namespace, stage }
    }

    /// Emit a count metric using EMF
    pub async fn emit_count(
        &self,
        metric_name: &str,
        value: f64,
        dimensions: Option<HashMap<String, String>>,
    ) {
        self.emit_emf_metric(metric_name, value, "Count", dimensions).await;
    }

    /// Emit a gauge metric (for things like number of connections) using EMF
    pub async fn emit_gauge(
        &self,
        metric_name: &str,
        value: f64,
        dimensions: Option<HashMap<String, String>>,
    ) {
        self.emit_emf_metric(metric_name, value, "None", dimensions).await;
    }

    /// Emit a duration metric in milliseconds using EMF
    pub async fn emit_duration_ms(
        &self,
        metric_name: &str,
        duration_ms: f64,
        dimensions: Option<HashMap<String, String>>,
    ) {
        self.emit_emf_metric(metric_name, duration_ms, "Milliseconds", dimensions).await;
    }

    async fn emit_emf_metric(
        &self,
        metric_name: &str,
        value: f64,
        unit: &str,
        dimensions: Option<HashMap<String, String>>,
    ) {
        let mut emf_log = json!({
            "_aws": {
                "Timestamp": chrono::Utc::now().timestamp_millis(),
                "CloudWatchMetrics": [{
                    "Namespace": self.namespace,
                    "Dimensions": [["Stage"]],
                    "Metrics": [{
                        "Name": metric_name,
                        "Unit": unit
                    }]
                }]
            },
            "Stage": self.stage,
            metric_name: value
        });

        // Add custom dimensions if provided
        if let Some(custom_dims) = dimensions {
            let mut dimension_keys = vec!["Stage".to_string()];

            for (key, dim_value) in custom_dims {
                emf_log[key.clone()] = json!(dim_value);
                dimension_keys.push(key);
            }

            // Update the dimension arrays in the CloudWatchMetrics
            emf_log["_aws"]["CloudWatchMetrics"][0]["Dimensions"] = json!([dimension_keys]);
        }

        // Log the EMF formatted JSON to stdout - CloudWatch Logs will automatically parse this
        println!("{}", emf_log);

        tracing::debug!("Emitted EMF metric: {} = {}", metric_name, value);
    }

    /// Convenience method to emit message-related metrics
    pub async fn emit_message_sent(&self, room_id: &str, message_length: usize) {
        let dimensions = HashMap::from([("RoomId".to_string(), room_id.to_string())]);

        // Count of messages sent
        self.emit_count("MessagesPosted", 1.0, Some(dimensions.clone())).await;

        // Message length distribution
        self.emit_gauge("MessageLength", message_length as f64, Some(dimensions)).await;
    }

    /// Convenience method to emit connection-related metrics
    pub async fn emit_connection_event(
        &self,
        event_type: &str,
        room_id: &str,
        total_connections: Option<i32>,
    ) {
        let dimensions = HashMap::from([
            ("EventType".to_string(), event_type.to_string()),
            ("RoomId".to_string(), room_id.to_string()),
        ]);

        // Count of connection events
        self.emit_count("ConnectionEvents", 1.0, Some(dimensions.clone())).await;

        // Current connection count if provided
        if let Some(count) = total_connections {
            self.emit_gauge("ActiveConnections", count as f64, Some(dimensions)).await;
        }
    }

    /// Convenience method to emit broadcast metrics
    pub async fn emit_message_broadcast(
        &self,
        room_id: &str,
        connection_count: i32,
        successful_sends: i32,
    ) {
        let dimensions = HashMap::from([("RoomId".to_string(), room_id.to_string())]);

        // Total broadcast attempts
        self.emit_count("BroadcastAttempts", connection_count as f64, Some(dimensions.clone()))
            .await;

        // Successful broadcasts
        self.emit_count("BroadcastSuccesses", successful_sends as f64, Some(dimensions.clone()))
            .await;

        // Failed broadcasts
        self.emit_count(
            "BroadcastFailures",
            (connection_count - successful_sends) as f64,
            Some(dimensions),
        )
        .await;
    }
}
