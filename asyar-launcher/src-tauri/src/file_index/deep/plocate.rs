//! Linux deep search via `plocate`. Only offered when the binary exists —
//! most distros ship `mlocate` or nothing by default, and an un-updated
//! locate database would silently miss recent files, so we probe rather
//! than assume.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crate::file_index::provider::{
    parse_path_lines, run_with_timeout, DeepProvider, FileSearchProvider, ProviderMode,
};

const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESULTS: &str = "200";

pub struct PlocateProvider;

impl FileSearchProvider for PlocateProvider {
    fn id(&self) -> &'static str {
        "plocate"
    }

    fn mode(&self) -> ProviderMode {
        ProviderMode::OnDemand
    }
}

impl DeepProvider for PlocateProvider {
    fn probe(&self) -> bool {
        let mut cmd = Command::new("plocate");
        cmd.arg("--version");
        run_with_timeout(cmd, PROBE_TIMEOUT).is_some()
    }

    fn search(&self, query: &str, limit: usize) -> Vec<PathBuf> {
        let mut cmd = Command::new("plocate");
        cmd.arg("-i").arg("-l").arg(MAX_RESULTS).arg(query);
        run_with_timeout(cmd, SEARCH_TIMEOUT)
            .map(|out| parse_path_lines(&out, limit))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_reports_on_demand_mode() {
        assert_eq!(PlocateProvider.mode(), ProviderMode::OnDemand);
        assert_eq!(PlocateProvider.id(), "plocate");
    }
}
