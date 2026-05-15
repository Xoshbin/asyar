use crate::agents::tools::{BuiltinTool, ToolDescriptor, ToolSource};
use crate::error::AppError;
use serde_json::json;

pub struct CalculatorTool;

impl CalculatorTool {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CalculatorTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl BuiltinTool for CalculatorTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            id: "calculator".to_string(),
            name: "Calculator".to_string(),
            description: "Evaluate a mathematical expression.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Math expression to evaluate, e.g. '2 + 2 * 3'"
                    }
                },
                "required": ["expression"]
            }),
            source: ToolSource::Builtin,
            fully_qualified_id: "builtin:calculator".to_string(),
        }
    }

    async fn invoke(&self, args: serde_json::Value) -> Result<serde_json::Value, AppError> {
        let expr = match args.get("expression").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => {
                return Err(AppError::Validation(
                    "missing required 'expression' string argument".to_string(),
                ))
            }
        };
        let value = evalexpr::eval(expr)
            .map_err(|e| AppError::Validation(format!("invalid expression: {}", e)))?;
        match value {
            evalexpr::Value::Int(i) => Ok(json!(i)),
            evalexpr::Value::Float(f) => Ok(json!(f)),
            evalexpr::Value::String(s) => Ok(json!(s)),
            evalexpr::Value::Boolean(b) => Ok(json!(b)),
            evalexpr::Value::Tuple(_) | evalexpr::Value::Empty => Err(AppError::Validation(
                "expression returned an unsupported type".to_string(),
            )),
        }
    }
}
