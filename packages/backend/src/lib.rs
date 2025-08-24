use std::{collections::HashMap, env};
use serde_json::json;

#[derive(Clone)]
pub struct MetricsHelper {
    namespace: String,
    stage: String,
}

impl MetricsHelper {
    pub async fn new() -> Self {
        let stage = env::var("STAGE").unwrap_or_else(|_| "unknown".to_string());
        let namespace = format!("SwflcodersChat/{}", stage);
        
        Self {
            namespace,
            stage,
        }
    }

    /// Emit a count metric using EMF
    pub async fn emit_count(&self, metric_name: &str, value: f64, dimensions: Option<HashMap<String, String>>) {
        self.emit_emf_metric(metric_name, value, "Count", dimensions).await;
    }

    /// Emit a gauge metric (for things like number of connections) using EMF
    pub async fn emit_gauge(&self, metric_name: &str, value: f64, dimensions: Option<HashMap<String, String>>) {
        self.emit_emf_metric(metric_name, value, "None", dimensions).await;
    }

    /// Emit a duration metric in milliseconds using EMF
    pub async fn emit_duration_ms(&self, metric_name: &str, duration_ms: f64, dimensions: Option<HashMap<String, String>>) {
        self.emit_emf_metric(metric_name, duration_ms, "Milliseconds", dimensions).await;
    }

    async fn emit_emf_metric(&self, metric_name: &str, value: f64, unit: &str, dimensions: Option<HashMap<String, String>>) {
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
        println!("{}", emf_log.to_string());
        
        tracing::debug!("Emitted EMF metric: {} = {}", metric_name, value);
    }

    /// Convenience method to emit message-related metrics
    pub async fn emit_message_sent(&self, room_id: &str, message_length: usize) {
        let dimensions = HashMap::from([
            ("RoomId".to_string(), room_id.to_string()),
        ]);

        // Count of messages sent
        self.emit_count("MessagesPosted", 1.0, Some(dimensions.clone())).await;
        
        // Message length distribution
        self.emit_gauge("MessageLength", message_length as f64, Some(dimensions)).await;
    }

    /// Convenience method to emit connection-related metrics
    pub async fn emit_connection_event(&self, event_type: &str, room_id: &str, total_connections: Option<i32>) {
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
    pub async fn emit_message_broadcast(&self, room_id: &str, connection_count: i32, successful_sends: i32) {
        let dimensions = HashMap::from([
            ("RoomId".to_string(), room_id.to_string()),
        ]);

        // Total broadcast attempts
        self.emit_count("BroadcastAttempts", connection_count as f64, Some(dimensions.clone())).await;
        
        // Successful broadcasts
        self.emit_count("BroadcastSuccesses", successful_sends as f64, Some(dimensions.clone())).await;
        
        // Failed broadcasts
        self.emit_count("BroadcastFailures", (connection_count - successful_sends) as f64, Some(dimensions)).await;
    }
}
