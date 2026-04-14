use crate::contracts::{EventSeverity, EventStage, Subsystem};
use crate::observability::EventHub;
use arx_rs::tools::Tool;
use arx_rs::types::ToolResult;
use async_trait::async_trait;
use serde_json::{json, Value};

const MERMAID_FLOWCHART_GUIDANCE: &str = "Mermaid diagram source code. For flowcharts, start with `flowchart TD` or `flowchart LR`. Use valid edge labels like `A -->|label| B`, `A -- text --> B`, or dotted arrows like `A -.->|label| B`. Do not use invalid dotted-label forms such as `A -.|label|-. B`; Mermaid rejects them.";

pub struct ChartTool {
    hub: EventHub,
    correlation_id: String,
}

impl ChartTool {
    pub fn new(hub: EventHub, correlation_id: String) -> Self {
        Self {
            hub,
            correlation_id,
        }
    }
}

#[async_trait]
impl Tool for ChartTool {
    fn name(&self) -> &'static str {
        "chart_set"
    }

    fn description(&self) -> &'static str {
        "Create or update a Mermaid chart in the Chart workspace tool. Use this when a flowchart/diagram helps. Flowcharts must be valid Mermaid; use edge labels like `A -->|label| B` or dotted arrows like `A -.->|label| B`, never `A -.|label|-. B`."
    }

    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "definition": { "type": "string", "description": MERMAID_FLOWCHART_GUIDANCE },
                "title": { "type": "string", "description": "Optional title/label for the chart." }
            },
            "required": ["definition"]
        })
    }

    fn format_call(&self, params: &Value) -> String {
        let title = params
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("chart");
        format!("chart_set(title={title})")
    }

    async fn execute(
        &self,
        params: Value,
        _cancel: Option<tokio::sync::watch::Receiver<bool>>,
    ) -> ToolResult {
        let definition = params
            .get("definition")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if definition.is_empty() {
            return ToolResult {
                success: false,
                result: Some("chart_set requires a non-empty definition".to_string()),
                images: None,
                display: Some("chart_set requires a non-empty definition".to_string()),
            };
        }
        if let Some(message) = validate_mermaid_definition(&definition) {
            return ToolResult {
                success: false,
                result: Some(message.clone()),
                images: None,
                display: Some(message),
            };
        }
        let title = params
            .get("title")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        self.hub.emit(self.hub.make_event(
            self.correlation_id.as_str(),
            Subsystem::Tool,
            "chart.definition.set",
            EventStage::Complete,
            EventSeverity::Info,
            json!({
                "definition": definition,
                "title": title
            }),
        ));

        ToolResult {
            success: true,
            result: Some("chart updated".to_string()),
            images: None,
            display: Some("Chart updated in workspace tool".to_string()),
        }
    }
}

fn validate_mermaid_definition(definition: &str) -> Option<String> {
    for (index, line) in definition.lines().enumerate() {
        if line.contains("-.|") || line.contains("|-.") {
            return Some(format!(
                "Invalid Mermaid dotted edge label on line {}. Use `A -.->|label| B` or `A -- text --> B`; do not use `A -.|label|-. B`.",
                index + 1
            ));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{validate_mermaid_definition, ChartTool, MERMAID_FLOWCHART_GUIDANCE};
    use arx_rs::tools::Tool;

    #[test]
    fn chart_schema_includes_flowchart_edge_guidance() {
        let tool = ChartTool::new(crate::observability::EventHub::new(), "test".to_string());
        let schema = tool.schema();
        let description = schema["properties"]["definition"]["description"]
            .as_str()
            .expect("definition description");

        assert!(description.contains("A -.->|label| B"));
        assert!(description.contains("A -.|label|-. B"));
        assert_eq!(description, MERMAID_FLOWCHART_GUIDANCE);
    }

    #[test]
    fn rejects_invalid_dotted_edge_label_syntax() {
        let invalid = "flowchart TD\n  Error -.|error value|-. CheckThreshold";
        let message = validate_mermaid_definition(invalid).expect("validation error");

        assert!(message.contains("line 2"));
        assert!(message.contains("A -.->|label| B"));
    }

    #[test]
    fn allows_valid_labeled_and_dotted_edges() {
        let valid = "flowchart TD\n  Error -.->|error value| CheckThreshold\n  A -->|ok| B";

        assert!(validate_mermaid_definition(valid).is_none());
    }
}
