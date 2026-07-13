//! Progress events emitted to the frontend during a runtime download,
//! mirroring `extensions::updater::UpdateProgress`'s serde conventions.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub(crate) enum RuntimeDownloadProgress {
    Resolving,
    #[serde(rename_all = "camelCase")]
    Downloading {
        bytes_downloaded: u64,
        total_bytes: u64,
    },
    Verifying,
    Extracting,
    Signing,
    Ready,
    #[serde(rename_all = "camelCase")]
    Failed {
        error: String,
    },
}
