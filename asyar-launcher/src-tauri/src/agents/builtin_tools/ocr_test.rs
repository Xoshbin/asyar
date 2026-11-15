use super::ocr::OcrImageTool;
use crate::agents::tools::BuiltinTool;
use crate::error::AppError;
use serde_json::json;

#[test]
fn test_ocr_tool_descriptor() {
    let tool = OcrImageTool::new();
    let desc = tool.descriptor();
    assert_eq!(desc.id, "ocr-image");
    assert_eq!(desc.name, "Read Text From Image (OCR)");
    assert_eq!(desc.fully_qualified_id, "builtin:ocr-image");
    assert!(desc.description.contains("OCR"));
    assert!(desc
        .parameters
        .get("required")
        .unwrap()
        .as_array()
        .unwrap()
        .contains(&json!("path")));
}

#[tokio::test]
async fn test_ocr_tool_missing_path_argument() {
    let tool = OcrImageTool::new();
    let result = tool.invoke(json!({})).await;
    assert!(matches!(result, Err(AppError::Validation(_))));
}

#[tokio::test]
async fn test_ocr_tool_nonexistent_file() {
    let tool = OcrImageTool::new();
    let non_existent =
        std::env::temp_dir().join(format!("no_such_file_{}.png", uuid::Uuid::new_v4()));
    let result = tool
        .invoke(json!({ "path": non_existent.to_str().unwrap() }))
        .await;
    assert!(matches!(result, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn test_ocr_tool_empty_file() {
    let tool = OcrImageTool::new();
    let empty_path = std::env::temp_dir().join(format!("empty_ocr_{}.png", uuid::Uuid::new_v4()));
    std::fs::write(&empty_path, b"").unwrap();
    let result = tool
        .invoke(json!({ "path": empty_path.to_str().unwrap() }))
        .await;
    let _ = std::fs::remove_file(&empty_path);
    assert_eq!(result.unwrap(), json!({ "text": "" }));
}
