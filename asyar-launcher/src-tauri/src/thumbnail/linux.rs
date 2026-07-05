//! Linux: no native thumbnail strategy yet. The freedesktop thumbnail spec
//! (`gnome-desktop-thumbnail`/D-Bus thumbnailer services) would cover this
//! properly but varies by desktop environment — deferred as documented
//! follow-up. Images already work cross-platform via
//! `thumbnail::image_thumb`.

use std::path::Path;

pub fn generate_via_quicklook(_path: &Path, _dest: &Path, _max_dim: u32) -> Result<(), String> {
    Err("no native thumbnail provider on Linux yet".to_string())
}
