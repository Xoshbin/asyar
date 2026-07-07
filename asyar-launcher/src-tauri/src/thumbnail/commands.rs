//! Thin Tauri command wrapper. All logic lives in `super::get_or_generate`
//! and the per-platform generators — this just extracts state, delegates,
//! and maps the result to the `asyar-thumb://` URL the frontend renders.

use tauri::{AppHandle, State};

use super::cache::get_thumbnail_cache_dir;
use super::ThumbnailState;

const DEFAULT_MAX_DIM: u32 = 256;

/// Returns the `asyar-thumb://` URL for `path`'s thumbnail, generating and
/// caching it first if needed. `None` when this file has no thumbnail
/// strategy on this platform — the frontend keeps its existing fallback.
#[tauri::command]
pub async fn get_file_thumbnail<R: tauri::Runtime>(
    path: String,
    max_dim: Option<u32>,
    app: AppHandle<R>,
    state: State<'_, std::sync::Arc<ThumbnailState>>,
) -> Result<Option<String>, String> {
    let max_dim = max_dim.unwrap_or(DEFAULT_MAX_DIM);
    let cache_dir = get_thumbnail_cache_dir(&app);
    let src = std::path::PathBuf::from(&path);

    let Some(cached_path) = super::get_or_generate(&state, &cache_dir, &src, max_dim).await else {
        return Ok(None);
    };

    let filename = cached_path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "generated thumbnail path has no file name".to_string())?;

    #[cfg(target_os = "windows")]
    let url = format!("http://asyar-thumb.localhost/{filename}");
    #[cfg(not(target_os = "windows"))]
    let url = format!("asyar-thumb://localhost/{filename}");

    Ok(Some(url))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::Manager as _;

    fn mock_app_with_state() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(std::sync::Arc::new(ThumbnailState::default()));
        app
    }

    #[tokio::test]
    async fn returns_a_thumb_url_for_a_supported_image() {
        let app = mock_app_with_state();
        let state: State<'_, std::sync::Arc<ThumbnailState>> = app.state();

        let src = std::env::temp_dir().join(format!(
            "thumb_cmd_test_{}_{}.png",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let img = image::RgbImage::from_pixel(50, 50, image::Rgb([1, 2, 3]));
        image::DynamicImage::ImageRgb8(img)
            .save_with_format(&src, image::ImageFormat::Png)
            .unwrap();

        let url = get_file_thumbnail(
            src.to_string_lossy().into_owned(),
            Some(64),
            app.handle().clone(),
            state,
        )
        .await
        .unwrap();

        assert!(url.is_some());
        assert!(url.unwrap().ends_with(".png"));
        let _ = std::fs::remove_file(&src);
    }

    #[tokio::test]
    async fn returns_none_for_a_missing_file() {
        let app = mock_app_with_state();
        let state: State<'_, std::sync::Arc<ThumbnailState>> = app.state();

        let url = get_file_thumbnail(
            "/definitely/missing/file.png".to_string(),
            None,
            app.handle().clone(),
            state,
        )
        .await
        .unwrap();

        assert!(url.is_none());
    }
}
