//! Runtime catalog: `name -> version -> platform key -> download artifact`.
//!
//! Fetched from a raw GitHub URL owned by the Asyar org, with a baked-in
//! fallback (`catalog.fallback.json`) so first-run works even when the
//! network fetch fails or the app is offline. The fallback is authoritative
//! for `bun`, `uv`, and `claude` today; `yt-dlp`/`ffmpeg` entries land later
//! as pure data additions to this same schema.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Default full-request timeout for the metadata client (catalog-JSON
/// fetch, HEAD size lookups) — small payloads, so a full timeout (not just
/// a connect timeout) is safe here without risking a large in-progress
/// download.
const METADATA_REQUEST_TIMEOUT_SECS: u64 = 30;

// TODO: confirm final catalog repo URL with owner — this org/repo is a
// placeholder until the catalog is actually published.
pub(crate) const CATALOG_URL: &str =
    "https://raw.githubusercontent.com/Xoshbin/asyar-runtime-catalog/main/catalog.json";

const FALLBACK_CATALOG_JSON: &str = include_str!("catalog.fallback.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ArchiveFormat {
    Zip,
    TarGz,
    Raw,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformArtifact {
    pub(crate) url: String,
    pub(crate) sha256: String,
    pub(crate) archive_format: ArchiveFormat,
    pub(crate) binary_path_in_archive: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RuntimeEntry {
    /// version -> platform key -> artifact.
    pub(crate) versions: HashMap<String, HashMap<String, PlatformArtifact>>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct RuntimeCatalog {
    pub(crate) runtimes: HashMap<String, RuntimeEntry>,
}

/// Maps a Rust `std::env::consts::OS`/`ARCH` pair to the Node-style platform
/// keys used throughout this catalog (and `catalog.fallback.json`).
pub(crate) fn resolve_platform_key(os: &str, arch: &str) -> Result<&'static str, String> {
    match (os, arch) {
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("linux", "x86_64") => Ok("linux-x64"),
        ("linux", "aarch64") => Ok("linux-arm64"),
        ("windows", "x86_64") => Ok("win32-x64"),
        ("windows", "aarch64") => Ok("win32-arm64"),
        _ => Err(format!("Unsupported platform: os={os}, arch={arch}")),
    }
}

/// TTL freshness check with an exclusive boundary: exactly-at-TTL counts as
/// stale, so a cache is never trusted for longer than `ttl_secs`.
pub(crate) fn is_cache_fresh(fetched_at: u64, now: u64, ttl_secs: u64) -> bool {
    now.saturating_sub(fetched_at) < ttl_secs
}

/// Looks up `name` in the remote catalog first (when available), falling
/// back to the baked-in copy. Never blocks or errors when `remote` is
/// `None` — a missing/unfetched remote catalog is a normal, common case.
pub(crate) fn resolve_runtime_entry<'a>(
    remote: Option<&'a RuntimeCatalog>,
    fallback: &'a RuntimeCatalog,
    name: &str,
) -> Option<&'a RuntimeEntry> {
    remote
        .and_then(|catalog| catalog.runtimes.get(name))
        .or_else(|| fallback.runtimes.get(name))
}

/// Parses the bundled fallback catalog. Panics only if the bundled JSON
/// itself is malformed — that's a build-time defect, not a runtime one.
pub(crate) fn fallback_catalog() -> RuntimeCatalog {
    serde_json::from_str(FALLBACK_CATALOG_JSON)
        .expect("bundled runtimes/catalog.fallback.json must parse")
}

/// Runtime names known at discovery time (the bundled fallback catalog's
/// keys), sorted for deterministic error messages. Deliberately does not
/// consult the remote catalog: manifest validation runs synchronously with
/// no network access, so "known" here means "known offline" — matching
/// `asyar-sdk/cli/lib/manifest.ts`'s `VALID_RUNTIMES`, which must be kept in
/// sync by hand.
pub(crate) fn known_names() -> Vec<String> {
    let mut names: Vec<String> = fallback_catalog().runtimes.keys().cloned().collect();
    names.sort();
    names
}

/// Whether `name` is a runtime known at discovery time (see `known_names`).
pub(crate) fn is_known_runtime(name: &str) -> bool {
    fallback_catalog().runtimes.contains_key(name)
}

/// Builds the shared HTTP client used for small metadata calls (catalog-JSON
/// fetch, artifact HEAD size lookups) — bounded by `timeout` so a stalled
/// server can never hang these indefinitely.
pub(crate) fn build_metadata_client_with_timeout(timeout: Duration) -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .expect("reqwest client with a timeout must build")
}

/// The metadata client used in production: a 30s full-request timeout.
pub(crate) fn build_metadata_client() -> reqwest::Client {
    build_metadata_client_with_timeout(Duration::from_secs(METADATA_REQUEST_TIMEOUT_SECS))
}

/// Best-effort fetch of the remote catalog. Returns `None` on any network,
/// HTTP, or parse failure so callers always have the fallback to lean on.
pub(crate) async fn fetch_remote_catalog(client: &reqwest::Client) -> Option<RuntimeCatalog> {
    let response = client.get(CATALOG_URL).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    serde_json::from_str(&text).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const CATALOG_FIXTURE: &str = r#"{
      "runtimes": {
        "bun": {
          "versions": {
            "1.1.0": {
              "darwin-arm64": {
                "url": "https://example.com/bun-darwin-arm64.zip",
                "sha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "archiveFormat": "zip",
                "binaryPathInArchive": "bun-darwin-aarch64/bun"
              },
              "linux-x64": {
                "url": "https://example.com/bun-linux-x64.zip",
                "sha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "archiveFormat": "zip",
                "binaryPathInArchive": "bun-linux-x64/bun"
              }
            }
          }
        },
        "uv": {
          "versions": {
            "0.4.9": {
              "darwin-arm64": {
                "url": "https://example.com/uv-aarch64-apple-darwin.tar.gz",
                "sha256": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "archiveFormat": "tarGz",
                "binaryPathInArchive": "uv-aarch64-apple-darwin/uv"
              }
            }
          }
        },
        "claude": {
          "versions": {
            "1.2.3": {
              "darwin-arm64": {
                "url": "https://downloads.claude.ai/claude-code-releases/1.2.3/darwin-arm64/claude",
                "sha256": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                "archiveFormat": "raw",
                "binaryPathInArchive": null
              }
            }
          }
        }
      }
    }"#;

    #[test]
    fn catalog_json_fixture_parses_into_expected_shape() {
        let catalog: RuntimeCatalog =
            serde_json::from_str(CATALOG_FIXTURE).expect("catalog fixture must parse");

        assert!(catalog.runtimes.contains_key("bun"));
        assert!(catalog.runtimes.contains_key("uv"));
        assert!(catalog.runtimes.contains_key("claude"));

        let bun_darwin_arm64 = &catalog.runtimes["bun"].versions["1.1.0"]["darwin-arm64"];
        assert_eq!(bun_darwin_arm64.archive_format, ArchiveFormat::Zip);
        assert_eq!(
            bun_darwin_arm64.binary_path_in_archive.as_deref(),
            Some("bun-darwin-aarch64/bun")
        );
        assert!(bun_darwin_arm64.sha256.starts_with("sha256:"));

        let uv_darwin_arm64 = &catalog.runtimes["uv"].versions["0.4.9"]["darwin-arm64"];
        assert_eq!(uv_darwin_arm64.archive_format, ArchiveFormat::TarGz);

        let claude_darwin_arm64 = &catalog.runtimes["claude"].versions["1.2.3"]["darwin-arm64"];
        assert_eq!(claude_darwin_arm64.archive_format, ArchiveFormat::Raw);
        assert_eq!(claude_darwin_arm64.binary_path_in_archive, None);
    }

    #[test]
    fn resolve_platform_key_covers_all_six_known_combos() {
        assert_eq!(
            resolve_platform_key("macos", "aarch64").unwrap(),
            "darwin-arm64"
        );
        assert_eq!(
            resolve_platform_key("macos", "x86_64").unwrap(),
            "darwin-x64"
        );
        assert_eq!(
            resolve_platform_key("linux", "x86_64").unwrap(),
            "linux-x64"
        );
        assert_eq!(
            resolve_platform_key("linux", "aarch64").unwrap(),
            "linux-arm64"
        );
        assert_eq!(
            resolve_platform_key("windows", "x86_64").unwrap(),
            "win32-x64"
        );
        assert_eq!(
            resolve_platform_key("windows", "aarch64").unwrap(),
            "win32-arm64"
        );
    }

    #[test]
    fn resolve_platform_key_errors_on_unknown_combo() {
        let result = resolve_platform_key("freebsd", "x86_64");
        assert!(result.is_err());
        let msg = result.unwrap_err();
        assert!(msg.contains("Unsupported platform"), "got: {msg}");
        assert!(msg.contains("freebsd"), "got: {msg}");
    }

    #[test]
    fn is_cache_fresh_true_one_second_before_ttl() {
        // fetched at t=1000, ttl=3600s, now=4599 -> 3599s elapsed, still fresh.
        assert!(is_cache_fresh(1000, 4599, 3600));
    }

    #[test]
    fn is_cache_fresh_false_exactly_at_ttl_boundary() {
        // now=4600 -> exactly 3600s elapsed -> considered stale (boundary is exclusive).
        assert!(!is_cache_fresh(1000, 4600, 3600));
    }

    #[test]
    fn is_cache_fresh_false_one_second_after_ttl() {
        assert!(!is_cache_fresh(1000, 4601, 3600));
    }

    fn fallback_catalog_with_ffmpeg() -> RuntimeCatalog {
        let mut platforms = HashMap::new();
        platforms.insert(
            "darwin-arm64".to_string(),
            PlatformArtifact {
                url: "https://example.com/ffmpeg.zip".to_string(),
                sha256: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
                    .to_string(),
                archive_format: ArchiveFormat::Zip,
                binary_path_in_archive: Some("ffmpeg".to_string()),
            },
        );
        let mut versions = HashMap::new();
        versions.insert("6.0".to_string(), platforms);
        let mut runtimes = HashMap::new();
        runtimes.insert("ffmpeg".to_string(), RuntimeEntry { versions });
        RuntimeCatalog { runtimes }
    }

    #[test]
    fn resolve_runtime_entry_uses_fallback_when_remote_unavailable() {
        let fallback = fallback_catalog_with_ffmpeg();

        // `None` simulates "network unavailable" — must resolve from the
        // baked-in fallback without blocking or erroring.
        let entry = resolve_runtime_entry(None, &fallback, "ffmpeg");
        assert!(
            entry.is_some(),
            "must resolve from fallback when remote is unavailable"
        );
    }

    #[test]
    fn resolve_runtime_entry_returns_none_when_absent_from_both() {
        let fallback = RuntimeCatalog {
            runtimes: HashMap::new(),
        };
        let entry = resolve_runtime_entry(None, &fallback, "does-not-exist");
        assert!(entry.is_none());
    }

    #[tokio::test]
    async fn metadata_client_with_a_short_timeout_never_hangs_past_it() {
        // A connection to an address that never responds — proves the
        // client's own configured timeout trips the request rather than
        // hanging forever. Bounded by an outer `tokio::time::timeout` so a
        // regression here fails the test instead of hanging the suite.
        let client = build_metadata_client_with_timeout(Duration::from_millis(200));

        let result = tokio::time::timeout(
            Duration::from_secs(5),
            client.get("http://10.255.255.1/").send(),
        )
        .await;

        assert!(
            result.is_ok(),
            "the client's own timeout must trip well before the outer test bound"
        );
        assert!(
            result.unwrap().is_err(),
            "an unreachable host must surface as a request error, not succeed"
        );
    }

    #[test]
    fn build_metadata_client_constructs_without_panicking() {
        let _client = build_metadata_client();
    }

    #[test]
    fn known_names_lists_the_three_bundled_runtimes_sorted() {
        assert_eq!(known_names(), vec!["bun", "claude", "uv"]);
    }

    #[test]
    fn is_known_runtime_true_for_bundled_names_false_for_unknown() {
        assert!(is_known_runtime("bun"));
        assert!(is_known_runtime("claude"));
        assert!(is_known_runtime("uv"));
        assert!(!is_known_runtime("ffmpeg"));
        assert!(!is_known_runtime(""));
    }

    /// Guards the hand-authored `catalog.fallback.json` itself: it must
    /// parse and cover all three provisioned runtimes across all six
    /// platform keys, so a typo there doesn't silently ship a broken
    /// first-run fallback.
    #[test]
    fn bundled_fallback_catalog_covers_all_platforms_for_all_runtimes() {
        let catalog = fallback_catalog();
        let platform_keys = [
            "darwin-arm64",
            "darwin-x64",
            "linux-x64",
            "linux-arm64",
            "win32-x64",
            "win32-arm64",
        ];

        for name in ["bun", "uv", "claude"] {
            let entry = catalog
                .runtimes
                .get(name)
                .unwrap_or_else(|| panic!("fallback catalog missing runtime '{name}'"));
            let (_version, platforms) = entry
                .versions
                .iter()
                .next()
                .unwrap_or_else(|| panic!("runtime '{name}' has no versions"));
            for key in platform_keys {
                assert!(
                    platforms.contains_key(key),
                    "runtime '{name}' missing platform '{key}'"
                );
            }
        }
    }
}
