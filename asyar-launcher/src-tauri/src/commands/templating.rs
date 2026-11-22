use crate::error::AppError;
use crate::templating::{
    get_available_placeholders as do_get_available_placeholders,
    resolve_portal_template as do_resolve_portal_template, resolve_template as do_resolve_template,
    PlaceholderMetadata, TemplateContext,
};

#[tauri::command]
pub async fn resolve_template(
    template: String,
    context: TemplateContext,
) -> Result<String, AppError> {
    do_resolve_template(&template, &context).await
}

#[tauri::command]
pub async fn resolve_portal_template(
    template: String,
    context: TemplateContext,
    encode_values: bool,
) -> Result<String, AppError> {
    do_resolve_portal_template(&template, &context, encode_values).await
}

#[tauri::command]
pub async fn get_available_placeholders() -> Result<Vec<PlaceholderMetadata>, AppError> {
    Ok(do_get_available_placeholders())
}
