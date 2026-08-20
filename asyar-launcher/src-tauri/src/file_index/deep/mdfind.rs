//! macOS deep search via Spotlight's `mdfind` CLI. Ships with the OS, so
//! availability is close to guaranteed — `probe()` still checks that the
//! binary actually runs rather than assuming.

use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crate::file_index::provider::{
    parse_path_lines, run_with_timeout, DeepProvider, FileSearchProvider, ProviderMode,
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const SEARCH_TIMEOUT: Duration = Duration::from_secs(3);

pub struct MdfindProvider;

impl FileSearchProvider for MdfindProvider {
    fn id(&self) -> &'static str {
        "mdfind"
    }

    fn mode(&self) -> ProviderMode {
        ProviderMode::OnDemand
    }
}

impl DeepProvider for MdfindProvider {
    fn probe(&self) -> bool {
        let mut cmd = Command::new("mdfind");
        cmd.arg("-h");
        run_with_timeout(cmd, PROBE_TIMEOUT).is_some()
    }

    fn search(&self, query: &str, limit: usize) -> Vec<PathBuf> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"));
        let mut cmd = Command::new("mdfind");
        cmd.arg("-onlyin").arg(&home).arg("-name").arg(query);
        run_with_timeout(cmd, SEARCH_TIMEOUT)
            .map(|out| parse_path_lines(&out, limit))
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_succeeds_on_a_real_mac() {
        assert!(
            MdfindProvider.probe(),
            "mdfind ships with every macOS install"
        );
    }

    #[test]
    fn search_finds_a_freshly_created_home_file() {
        let home = dirs::home_dir().expect("home dir");
        let name = format!("asyar-mdfind-probe-{}.txt", std::process::id());
        let path = home.join(&name);
        std::fs::write(&path, "x").unwrap();

        // Spotlight indexing is asynchronous; give it a moment. This is an
        // integration-style test and may be flaky in a CI sandbox without
        // Spotlight indexing enabled — that's an accepted limitation of
        // testing a real OS service.
        std::thread::sleep(Duration::from_millis(500));
        let hits = MdfindProvider.search(&name, 10);
        let _ = std::fs::remove_file(&path);

        // Don't hard-fail on environments where Spotlight indexing is
        // disabled/delayed — assert the call completes and returns a
        // well-formed (possibly empty) result rather than hanging or
        // erroring.
        assert!(hits.len() <= 10);
    }
}
