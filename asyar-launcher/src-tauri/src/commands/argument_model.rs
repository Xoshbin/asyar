use crate::extensions::argument_model::{
    resolve, ArgumentModelResolution, ResolveArgumentModelRequest,
};

/// Thin wrapper over [`crate::extensions::argument_model::resolve`] — stateless,
/// no I/O, so no `AppError` result: the request is always resolvable.
#[tauri::command]
pub fn resolve_command_arguments(request: ResolveArgumentModelRequest) -> ArgumentModelResolution {
    resolve(&request)
}
