use crate::DomainError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolDescriptor {
    pub id: String,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolInput {
    pub payload_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolOutput {
    pub payload_json: String,
}

pub trait ToolContext {
    fn deadline_ms(&self) -> Option<u64>;
    fn is_cancelled(&self) -> bool;
}

pub trait Tool: Send + Sync {
    fn descriptor(&self) -> &ToolDescriptor;

    fn execute(
        &self,
        context: &dyn ToolContext,
        input: ToolInput,
    ) -> Result<ToolOutput, DomainError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NoopContext;

    impl ToolContext for NoopContext {
        fn deadline_ms(&self) -> Option<u64> {
            None
        }

        fn is_cancelled(&self) -> bool {
            false
        }
    }

    struct EchoTool {
        descriptor: ToolDescriptor,
    }

    impl Tool for EchoTool {
        fn descriptor(&self) -> &ToolDescriptor {
            &self.descriptor
        }

        fn execute(
            &self,
            _context: &dyn ToolContext,
            input: ToolInput,
        ) -> Result<ToolOutput, DomainError> {
            Ok(ToolOutput {
                payload_json: input.payload_json,
            })
        }
    }

    #[test]
    fn echo_tool_roundtrips_payload() {
        let tool = EchoTool {
            descriptor: ToolDescriptor {
                id: "echo".to_string(),
                version: "1.0.0".to_string(),
                description: "Echo payload".to_string(),
            },
        };
        let ctx = NoopContext;
        let result = tool
            .execute(
                &ctx,
                ToolInput {
                    payload_json: "{\"x\":1}".to_string(),
                },
            )
            .unwrap();
        assert_eq!(result.payload_json, "{\"x\":1}");
    }
}
