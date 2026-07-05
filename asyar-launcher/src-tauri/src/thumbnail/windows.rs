//! Windows: no native thumbnail strategy yet. `IThumbnailProvider`/shell
//! COM interop would cover this properly (PDFs, videos, Office docs) but
//! is a meaningfully larger integration — deferred as documented follow-up.
//! Images already work cross-platform via `thumbnail::image_thumb`.

use std::path::Path;

pub fn generate_via_quicklook(_path: &Path, _dest: &Path, _max_dim: u32) -> Result<(), String> {
    Err("no native thumbnail provider on Windows yet".to_string())
}
