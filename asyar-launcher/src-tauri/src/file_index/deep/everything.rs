//! Windows deep search via voidtools' Everything CLI (`es.exe`). Only
//! offered when `es.exe` resolves on PATH — Everything is a popular but
//! third-party install, unlike macOS's built-in Spotlight.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crate::file_index::provider::{
    parse_path_lines, run_with_timeout, DeepProvider, FileSearchProvider, ProviderMode,
};

const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_RESULTS: &str = "200";

pub struct EverythingProvider;

impl FileSearchProvider for EverythingProvider {
    fn id(&self) -> &'static str {
        "everything"
    }

    fn mode(&self) -> ProviderMode {
        ProviderMode::OnDemand
    }
}

impl DeepProvider for EverythingProvider {
    fn probe(&self) -> bool {
        let mut cmd = Command::new("es.exe");
        cmd.arg("-version");
        run_with_timeout(cmd, PROBE_TIMEOUT).is_some()
    }

    fn search(&self, query: &str, limit: usize) -> Vec<PathBuf> {
        let mut cmd = Command::new("es.exe");
        cmd.arg("-n").arg(MAX_RESULTS).arg(query);
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
        assert_eq!(EverythingProvider.mode(), ProviderMode::OnDemand);
        assert_eq!(EverythingProvider.id(), "everything");
    }
}
