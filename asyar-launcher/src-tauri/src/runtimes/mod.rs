//! On-demand sidecar runtime manager: downloads, verifies, and installs
//! `bun`/`uv`/`claude` (and future runtimes added as pure catalog-data
//! entries, e.g. `yt-dlp`/`ffmpeg`) into app data the first time a feature
//! or extension actually needs them, replacing the build-time-bundled
//! `externalBin` binaries.
//!
//! Reached from the frontend/CLI through `commands/runtimes.rs`'s Tauri
//! commands (`resolve_runtime`, `ensure_runtime`, `download_runtime`,
//! `list_runtimes`, `remove_runtime`, `get_runtime_download_sizes`);
//! `RuntimeManager` itself owns all the resolve/ensure/download/list/remove
//! business logic.

pub(crate) mod catalog;
pub(crate) mod download;
pub(crate) mod extract;
pub(crate) mod install;
pub(crate) mod progress;

use crate::error::AppError;
pub(crate) use progress::RuntimeDownloadProgress;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const CATALOG_CACHE_TTL_SECS: u64 = 3600;

// `is_last_consumer` below is still `#[allow(dead_code)]`: nothing calls it
// through the public Tauri command surface yet — Settings' "remove runtime"
// warning instead reads the full consumer list via `consumers_of` (exposed
// through `get_runtime_consumers`). `add`/`remove` are genuinely used now
// (`download_runtime`'s consumer param, extension uninstall, MCP install/
// enable/disable/delete, the AI Extension Builder).

/// Tracks which consumers (extension IDs or built-in feature IDs) currently
/// require each runtime, so uninstalling the last consumer can offer
/// cleanup instead of silently deleting a runtime another consumer still
/// needs.
#[derive(Debug, Default)]
pub(crate) struct ConsumerRegistry {
    consumers: HashMap<String, HashSet<String>>,
}

impl ConsumerRegistry {
    #[allow(dead_code)]
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn add(&mut self, runtime: &str, consumer: &str) {
        self.consumers
            .entry(runtime.to_string())
            .or_default()
            .insert(consumer.to_string());
    }

    pub(crate) fn remove(&mut self, runtime: &str, consumer: &str) {
        if let Some(set) = self.consumers.get_mut(runtime) {
            set.remove(consumer);
            if set.is_empty() {
                self.consumers.remove(runtime);
            }
        }
    }

    #[allow(dead_code)]
    pub(crate) fn is_last_consumer(&self, runtime: &str, consumer: &str) -> bool {
        self.consumers
            .get(runtime)
            .is_some_and(|set| set.len() == 1 && set.contains(consumer))
    }

    /// Every consumer id currently registered against `runtime`, or an empty
    /// vec if none are. Used by Settings (which isn't itself a consumer) to
    /// ask "who is using this" before offering to remove it.
    pub(crate) fn consumers_of(&self, runtime: &str) -> Vec<String> {
        self.consumers
            .get(runtime)
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }
}

/// Outcome of `ensure()`: either the runtime is already installed, or it
/// isn't and the caller needs to drive a consent+download flow first.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum EnsureResult {
    Installed(PathBuf),
    NeedsDownload { size_bytes: u64 },
}

/// Rejects runtime names that could escape the runtimes root once joined
/// into a filesystem path: empty, containing `..`, or already absolute
/// (`Path::join` discards the base entirely when the RHS is absolute, so an
/// unvalidated absolute name silently redirects the join outside the root).
pub(crate) fn validate_runtime_name(name: &str) -> Result<(), AppError> {
    if name.trim().is_empty() {
        return Err(AppError::Validation(
            "Runtime name cannot be empty".to_string(),
        ));
    }
    if name.contains("..") {
        return Err(AppError::Validation(format!(
            "Runtime name '{name}' contains invalid characters"
        )));
    }
    if Path::new(name).is_absolute() {
        return Err(AppError::Validation(format!(
            "Runtime name '{name}' must not be an absolute path"
        )));
    }
    Ok(())
}

/// Testable core of `resolve()`: given an injected `lookup` (installed-path
/// resolver), returns the installed path or `None`.
pub(crate) fn resolve_with_lookup(
    name: &str,
    lookup: impl Fn(&str) -> Option<PathBuf>,
) -> Option<PathBuf> {
    lookup(name)
}

/// Testable core of `ensure()`: resolves via `resolve_lookup`, falling back
/// to `size_lookup` (only invoked when not installed) to report the
/// download size the caller should get consent for.
pub(crate) fn ensure_with_lookup(
    name: &str,
    resolve_lookup: impl Fn(&str) -> Option<PathBuf>,
    size_lookup: impl Fn(&str) -> u64,
) -> EnsureResult {
    match resolve_lookup(name) {
        Some(path) => EnsureResult::Installed(path),
        None => EnsureResult::NeedsDownload {
            size_bytes: size_lookup(name),
        },
    }
}

/// A runtime that still needs downloading: `resolve` reported it absent and
/// the size lookup reports a size to get consent for. Shared by
/// `RuntimeManager::missing_of` (an arbitrary declared-runtime list, e.g. an
/// extension manifest's `runtimes` field) and `ext_builder::process` (the
/// fixed `["bun", "claude"]` build-tool check), so this "cheap local
/// resolve, pay network cost only for what's actually missing" pattern has
/// one implementation, not two.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MissingRuntime {
    pub(crate) name: String,
    pub(crate) size_bytes: u64,
}

/// Reports the download size for a runtime already known (by the caller) to
/// be unresolved through its local resolve tiers. Injectable so
/// `missing_of_with`'s tests never hit the network `RuntimeManager::ensure`
/// makes, and so tests can assert it's queried only for actually-missing
/// names.
#[async_trait::async_trait]
pub(crate) trait RuntimeSizeLookup: Send + Sync {
    async fn needs_download(&self, name: &str) -> Result<Option<u64>, AppError>;
}

/// Testable core: given already-resolved local lookups (via `resolve`) and
/// an injected size lookup, returns the subset of `names` that still need
/// downloading. `size_lookup` is only ever consulted for a name whose
/// `resolve` returned `None` — never pay the network cost for a runtime
/// that's already resolvable.
pub(crate) async fn missing_of_with(
    names: &[String],
    resolve: impl Fn(&str) -> Option<PathBuf>,
    size_lookup: &dyn RuntimeSizeLookup,
) -> Result<Vec<MissingRuntime>, AppError> {
    let mut out = Vec::new();
    for name in names {
        if resolve(name).is_none() {
            if let Some(size_bytes) = size_lookup.needs_download(name).await? {
                out.push(MissingRuntime {
                    name: name.clone(),
                    size_bytes,
                });
            }
        }
    }
    Ok(out)
}

/// Production adapter over `RuntimeManager::ensure`'s network call — shared
/// by `RuntimeManager::missing_of` and `ext_builder::process::missing_runtimes`
/// (which needs its own bundled-binary-tier `resolve` closures but the same
/// network size lookup).
pub(crate) struct RuntimeManagerSizeLookup<'a> {
    pub(crate) app: &'a AppHandle,
    pub(crate) manager: &'a RuntimeManager,
}

#[async_trait::async_trait]
impl RuntimeSizeLookup for RuntimeManagerSizeLookup<'_> {
    async fn needs_download(&self, name: &str) -> Result<Option<u64>, AppError> {
        match self.manager.ensure(self.app, name).await? {
            EnsureResult::Installed(_) => Ok(None),
            EnsureResult::NeedsDownload { size_bytes } => Ok(Some(size_bytes)),
        }
    }
}

/// A runtime installed under `<app_data_dir>/runtimes/<name>/<version>/`,
/// as surfaced to the frontend's Settings list. `pub` (not `pub(crate)`)
/// because it's the return type of the `pub` `list_runtimes` Tauri command.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledRuntimeInfo {
    pub name: String,
    pub version: String,
    pub path: PathBuf,
    pub size_bytes: u64,
}

/// Managed Tauri state owning the consumer registry and the fetched-catalog
/// cache. Business logic for resolve/ensure/download/list/remove lives
/// here; `commands/runtimes.rs` only translates this to/from IPC shapes.
pub struct RuntimeManager {
    registry: Mutex<ConsumerRegistry>,
    remote_cache: Mutex<Option<(catalog::RuntimeCatalog, u64)>>,
    /// Per-runtime-name async locks so two concurrent `download()` calls for
    /// the same runtime serialize instead of racing on the shared staging
    /// directory (`install::install_atomically` unconditionally clears
    /// `<name>-staging` at the start of a populate).
    download_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Shared client for small metadata calls (catalog-JSON fetch, artifact
    /// HEAD size lookups) — full 30s request timeout.
    metadata_client: reqwest::Client,
    /// Shared client for streaming archive downloads — connect-only
    /// timeout, since a full-request timeout would kill a large in-progress
    /// download.
    download_client: reqwest::Client,
}

impl Default for RuntimeManager {
    fn default() -> Self {
        Self {
            registry: Mutex::new(ConsumerRegistry::default()),
            remote_cache: Mutex::new(None),
            download_locks: Mutex::new(HashMap::new()),
            metadata_client: catalog::build_metadata_client(),
            download_client: download::build_download_client(),
        }
    }
}

impl RuntimeManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns the shared per-name async lock, creating it on first use.
    /// Concurrent `download()` calls for the same name await the same
    /// `tokio::sync::Mutex`, so the second caller naturally waits for the
    /// first to finish instead of racing its populate/cleanup.
    fn download_lock_for(&self, name: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = match self.download_locks.lock() {
            Ok(locks) => locks,
            Err(poisoned) => poisoned.into_inner(),
        };
        locks
            .entry(name.to_string())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }

    pub(crate) fn add_consumer(&self, runtime: &str, consumer: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.add(runtime, consumer);
        }
    }

    pub(crate) fn remove_consumer(&self, runtime: &str, consumer: &str) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.remove(runtime, consumer);
        }
    }

    #[allow(dead_code)]
    pub(crate) fn is_last_consumer(&self, runtime: &str, consumer: &str) -> bool {
        self.registry
            .lock()
            .map(|registry| registry.is_last_consumer(runtime, consumer))
            .unwrap_or(false)
    }

    /// Every consumer id currently registered against `runtime` — a pure
    /// registry read, no filesystem/network access.
    pub(crate) fn consumers_of(&self, runtime: &str) -> Vec<String> {
        self.registry
            .lock()
            .map(|registry| registry.consumers_of(runtime))
            .unwrap_or_default()
    }

    fn runtimes_root(app_handle: &AppHandle) -> Result<PathBuf, AppError> {
        Ok(crate::extensions::get_app_data_dir(app_handle)?.join("runtimes"))
    }

    /// Installed path for `name`, or `None` if it hasn't been downloaded yet.
    pub(crate) fn resolve(&self, app_handle: &AppHandle, name: &str) -> Option<PathBuf> {
        let root = Self::runtimes_root(app_handle).ok()?;
        resolve_with_lookup(name, |n| installed_binary_path(&root, n))
    }

    /// `Installed(path)` if already downloaded, otherwise
    /// `NeedsDownload{size_bytes}` with a best-effort size from the catalog
    /// artifact's `Content-Length` (0 if that can't be determined).
    pub(crate) async fn ensure(
        &self,
        app_handle: &AppHandle,
        name: &str,
    ) -> Result<EnsureResult, AppError> {
        validate_runtime_name(name)?;
        let root = Self::runtimes_root(app_handle)?;
        if let Some(installed) = resolve_with_lookup(name, |n| installed_binary_path(&root, n)) {
            return Ok(EnsureResult::Installed(installed));
        }
        // Not installed — only now pay for the network size lookup.
        let size_bytes = self.remote_download_size(name).await.unwrap_or(0);
        Ok(ensure_with_lookup(name, |_| None, |_| size_bytes))
    }

    async fn remote_download_size(&self, name: &str) -> Option<u64> {
        let (_version, artifact) = self.resolve_artifact(name).await.ok()?;
        let response = self.metadata_client.head(&artifact.url).send().await.ok()?;
        response.content_length()
    }

    /// Resolves `name` to its latest published version + this platform's
    /// artifact, fetching the remote catalog (TTL-cached) first. Shared by
    /// `remote_download_size` and `download_inner` — see
    /// `resolve_artifact_from_catalog` for why this dedup matters.
    async fn resolve_artifact(
        &self,
        name: &str,
    ) -> Result<(String, catalog::PlatformArtifact), AppError> {
        let remote = self.remote_catalog().await;
        let fallback = catalog::fallback_catalog();
        resolve_artifact_from_catalog(remote.as_ref(), &fallback, name)
    }

    /// Fetches the remote catalog, honoring a TTL cache; falls back to
    /// `None` (letting callers fall through to the baked-in fallback
    /// catalog) on any cache miss + fetch failure.
    async fn remote_catalog(&self) -> Option<catalog::RuntimeCatalog> {
        let now = now_unix();
        if let Ok(cache) = self.remote_cache.lock() {
            if let Some((cached, fetched_at)) = cache.as_ref() {
                if catalog::is_cache_fresh(*fetched_at, now, CATALOG_CACHE_TTL_SECS) {
                    return Some(cached.clone());
                }
            }
        }
        let fetched = catalog::fetch_remote_catalog(&self.metadata_client).await?;
        if let Ok(mut cache) = self.remote_cache.lock() {
            *cache = Some((fetched.clone(), now));
        }
        Some(fetched)
    }

    /// Downloads, verifies, extracts, and atomically installs `name`,
    /// emitting `runtime_download_progress` events at each stage (mirrors
    /// `extensions::updater`'s `emit_progress` pattern).
    pub(crate) async fn download(
        &self,
        app_handle: &AppHandle,
        name: &str,
    ) -> Result<(), AppError> {
        let lock = self.download_lock_for(name);
        let _guard = lock.lock().await;

        // Another in-flight `download()` call for this name may have
        // already installed it while we were waiting on the lock above.
        if self.resolve(app_handle, name).is_some() {
            return Ok(());
        }

        let result = self.download_inner(app_handle, name).await;
        if let Err(ref e) = result {
            emit_progress(
                app_handle,
                RuntimeDownloadProgress::Failed {
                    error: e.to_string(),
                },
            );
        }
        result
    }

    async fn download_inner(&self, app_handle: &AppHandle, name: &str) -> Result<(), AppError> {
        validate_runtime_name(name)?;
        emit_progress(app_handle, RuntimeDownloadProgress::Resolving);

        let (version, artifact) = self.resolve_artifact(name).await?;

        let temp_file = download::download_to_temp_file(
            &self.download_client,
            &artifact.url,
            |downloaded, total| {
                emit_progress(
                    app_handle,
                    RuntimeDownloadProgress::Downloading {
                        bytes_downloaded: downloaded,
                        total_bytes: total,
                    },
                );
            },
        )
        .await?;

        emit_progress(app_handle, RuntimeDownloadProgress::Verifying);
        download::verify_and_cleanup(temp_file.path(), &artifact.sha256)?;

        emit_progress(app_handle, RuntimeDownloadProgress::Extracting);
        let binary_name = binary_file_name(name);
        let extract_temp = tempfile::TempDir::new().map_err(AppError::Io)?;
        let extracted_binary = match artifact.archive_format {
            catalog::ArchiveFormat::Zip => {
                extract::extract_zip(temp_file.path(), extract_temp.path()).await?;
                extract_temp.path().join(
                    artifact
                        .binary_path_in_archive
                        .as_deref()
                        .unwrap_or(&binary_name),
                )
            }
            catalog::ArchiveFormat::TarGz => {
                extract::extract_tar_gz(temp_file.path(), extract_temp.path())?;
                extract_temp.path().join(
                    artifact
                        .binary_path_in_archive
                        .as_deref()
                        .unwrap_or(&binary_name),
                )
            }
            catalog::ArchiveFormat::Raw => temp_file.path().to_path_buf(),
        };

        let root = Self::runtimes_root(app_handle)?;
        let staging_dir = root.join(format!("{name}-staging"));
        let final_dir = root.join(name).join(&version);

        install::install_atomically(&staging_dir, &final_dir, |dir| {
            std::fs::create_dir_all(dir)?;
            let dest_binary = dir.join(&binary_name);
            extract::copy_raw(&extracted_binary, &dest_binary)?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dest_binary, std::fs::Permissions::from_mode(0o755))?;
            }
            Ok(())
        })?;

        // `needs_resign` stays the single source of truth for the decision
        // so it's exercised by its own unit tests; only macOS actually
        // checks the binary's real signature (shells out to `codesign`),
        // since `needs_resign` short-circuits on `is_macos` everywhere else.
        #[cfg(target_os = "macos")]
        let has_valid_signature = install::has_valid_signature(&final_dir.join(&binary_name));
        #[cfg(not(target_os = "macos"))]
        let has_valid_signature = false;

        if install::needs_resign(cfg!(target_os = "macos"), has_valid_signature) {
            emit_progress(app_handle, RuntimeDownloadProgress::Signing);
            #[cfg(target_os = "macos")]
            install::resign_adhoc(&final_dir.join(&binary_name))?;
        }

        emit_progress(app_handle, RuntimeDownloadProgress::Ready);
        Ok(())
    }

    /// Lists every installed runtime/version under `<app_data_dir>/runtimes/`
    /// with its on-disk size, for the Settings surface.
    pub(crate) fn list(
        &self,
        app_handle: &AppHandle,
    ) -> Result<Vec<InstalledRuntimeInfo>, AppError> {
        let root = Self::runtimes_root(app_handle)?;
        if !root.exists() {
            return Ok(Vec::new());
        }

        let mut out = Vec::new();
        for name_entry in std::fs::read_dir(&root)? {
            let name_entry = name_entry?;
            if !name_entry.file_type()?.is_dir() {
                continue;
            }
            let name = name_entry.file_name().to_string_lossy().to_string();
            for version_entry in std::fs::read_dir(name_entry.path())? {
                let version_entry = version_entry?;
                if !version_entry.file_type()?.is_dir() {
                    continue;
                }
                let version = version_entry.file_name().to_string_lossy().to_string();
                let path = version_entry.path();
                let size_bytes = dir_size(&path);
                out.push(InstalledRuntimeInfo {
                    name: name.clone(),
                    version,
                    path,
                    size_bytes,
                });
            }
        }
        Ok(out)
    }

    /// Given an arbitrary list of declared runtime names (e.g. an extension
    /// manifest's `runtimes` field), returns the ones not yet installed with
    /// their download size. The general form of
    /// `ext_builder::process::missing_runtimes`, which needs its own
    /// bundled-binary resolve tiers for the fixed `["bun", "claude"]` case
    /// and so calls `missing_of_with` directly instead of this method.
    pub(crate) async fn missing_of(
        &self,
        app_handle: &AppHandle,
        names: &[String],
    ) -> Result<Vec<MissingRuntime>, AppError> {
        let lookup = RuntimeManagerSizeLookup {
            app: app_handle,
            manager: self,
        };
        missing_of_with(names, |n| self.resolve(app_handle, n), &lookup).await
    }

    /// Removes every installed version of `name`. Callers are responsible
    /// for checking `is_last_consumer` first and surfacing a warning — this
    /// method itself does not consult the consumer registry, so it can also
    /// serve a forced "remove anyway" action from Settings.
    pub(crate) fn remove(&self, app_handle: &AppHandle, name: &str) -> Result<(), AppError> {
        let root = Self::runtimes_root(app_handle)?;
        remove_from_root(&root, name)
    }
}

/// Testable core of `remove()`: validates `name`, then deletes
/// `<runtimes_root>/<name>` if it exists.
fn remove_from_root(runtimes_root: &Path, name: &str) -> Result<(), AppError> {
    validate_runtime_name(name)?;
    let name_dir = runtimes_root.join(name);
    if name_dir.exists() {
        std::fs::remove_dir_all(&name_dir)?;
    }
    Ok(())
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn binary_file_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Picks the highest installed version dir for `name` under `runtimes_root`
/// and returns its binary path, if the binary actually exists there.
fn installed_binary_path(runtimes_root: &Path, name: &str) -> Option<PathBuf> {
    validate_runtime_name(name).ok()?;
    let name_dir = runtimes_root.join(name);
    let mut versions: Vec<(semver::Version, PathBuf)> = std::fs::read_dir(&name_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter_map(|p| {
            let raw = p.file_name()?.to_str()?;
            semver::Version::parse(raw).ok().map(|v| (v, p))
        })
        .collect();
    versions.sort_by(|a, b| a.0.cmp(&b.0));
    let (_, version_dir) = versions.pop()?;
    let binary_path = version_dir.join(binary_file_name(name));
    binary_path.is_file().then_some(binary_path)
}

/// Picks the highest semver version key published for a catalog entry.
///
/// Errors with a diagnostic message (rather than a generic "no published
/// versions") when the entry has version keys but *all* of them fail
/// semver parsing — e.g. a future date-tagged catalog entry like
/// `"2025.01.15"` — so that failure mode is debuggable instead of silently
/// indistinguishable from "this runtime has no versions at all."
fn latest_version(entry: &catalog::RuntimeEntry) -> Result<String, String> {
    let mut unparseable: Vec<&str> = Vec::new();
    let mut parsed: Vec<(semver::Version, &str)> = Vec::new();
    for raw in entry.versions.keys() {
        match semver::Version::parse(raw) {
            Ok(v) => parsed.push((v, raw.as_str())),
            Err(_) => unparseable.push(raw.as_str()),
        }
    }
    if let Some((_, raw)) = parsed.into_iter().max_by(|a, b| a.0.cmp(&b.0)) {
        return Ok(raw.to_string());
    }
    if unparseable.is_empty() {
        Err("has no published versions".to_string())
    } else {
        Err(format!(
            "has no semver-parseable versions (found: {})",
            unparseable.join(", ")
        ))
    }
}

/// Pure core of artifact resolution: given an already-fetched
/// `remote`/`fallback` catalog pair, resolves `name` to its latest
/// published version + this platform's artifact. Shared by
/// `remote_download_size` and `download_inner` so the pre-download size
/// estimate and the actual download can't diverge due to duplicated
/// resolution logic — they can still diverge if the catalog itself changes
/// between the two separate IPC calls (full pinning, e.g. `ensure()`
/// returning a token `download()` must present, is a larger design change
/// and out of scope here).
fn resolve_artifact_from_catalog(
    remote: Option<&catalog::RuntimeCatalog>,
    fallback: &catalog::RuntimeCatalog,
    name: &str,
) -> Result<(String, catalog::PlatformArtifact), AppError> {
    let entry = catalog::resolve_runtime_entry(remote, fallback, name)
        .ok_or_else(|| AppError::NotFound(format!("Unknown runtime '{name}'")))?;

    let version = latest_version(entry)
        .map_err(|reason| AppError::NotFound(format!("Runtime '{name}' {reason}")))?;
    let platform_key = catalog::resolve_platform_key(std::env::consts::OS, std::env::consts::ARCH)
        .map_err(AppError::Platform)?;
    let artifact = entry
        .versions
        .get(&version)
        .and_then(|platforms| platforms.get(platform_key))
        .cloned()
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "Runtime '{name}' v{version} has no build for platform '{platform_key}'"
            ))
        })?;

    Ok((version, artifact))
}

/// On-disk size of `path`'s subtree. Delegates to
/// `application::uninstall::dir_size_bytes` — same best-effort accounting,
/// same symlink-skip behavior — rather than maintaining a second copy that
/// could drift out of sync (e.g. by following symlinks and risking
/// unbounded recursion on a symlink loop).
fn dir_size(path: &Path) -> u64 {
    crate::application::uninstall::dir_size_bytes(path)
}

fn emit_progress(app_handle: &AppHandle, progress: RuntimeDownloadProgress) {
    if let Err(e) = app_handle.emit("runtime_download_progress", &progress) {
        log::warn!("Failed to emit runtime download progress event: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consumer_registry_add_registers_a_consumer() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        assert!(registry.is_last_consumer("bun", "mcp:server-a"));
    }

    #[test]
    fn consumer_registry_is_last_consumer_false_with_multiple_consumers() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        registry.add("bun", "ext-builder");

        assert!(!registry.is_last_consumer("bun", "mcp:server-a"));
        assert!(!registry.is_last_consumer("bun", "ext-builder"));
    }

    #[test]
    fn consumer_registry_is_last_consumer_true_after_removing_others() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        registry.add("bun", "ext-builder");
        registry.remove("bun", "ext-builder");

        assert!(registry.is_last_consumer("bun", "mcp:server-a"));
    }

    #[test]
    fn consumer_registry_is_last_consumer_false_when_consumer_not_registered() {
        let registry = ConsumerRegistry::new();
        assert!(!registry.is_last_consumer("bun", "unregistered-consumer"));
    }

    #[test]
    fn consumer_registry_add_is_idempotent_for_same_consumer() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        registry.add("bun", "mcp:server-a");
        assert!(registry.is_last_consumer("bun", "mcp:server-a"));
    }

    #[test]
    fn consumer_registry_tracks_runtimes_independently() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "ext-builder");
        registry.add("uv", "mcp:server-a");

        assert!(registry.is_last_consumer("bun", "ext-builder"));
        assert!(registry.is_last_consumer("uv", "mcp:server-a"));

        // Removing bun's only consumer must not affect uv's registration.
        registry.remove("bun", "ext-builder");
        assert!(!registry.is_last_consumer("bun", "ext-builder"));
        assert!(registry.is_last_consumer("uv", "mcp:server-a"));
    }

    // ── Phase 5: consumers_of (Settings "who is using this runtime") ───────

    #[test]
    fn consumer_registry_consumers_of_is_empty_when_nothing_registered() {
        let registry = ConsumerRegistry::new();
        assert_eq!(registry.consumers_of("bun"), Vec::<String>::new());
    }

    #[test]
    fn consumer_registry_consumers_of_lists_every_registered_consumer() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        registry.add("bun", "builtin:ext-builder");

        let mut consumers = registry.consumers_of("bun");
        consumers.sort();
        assert_eq!(consumers, vec!["builtin:ext-builder", "mcp:server-a"]);
    }

    #[test]
    fn consumer_registry_consumers_of_updates_after_remove() {
        let mut registry = ConsumerRegistry::new();
        registry.add("bun", "mcp:server-a");
        registry.add("bun", "builtin:ext-builder");
        registry.remove("bun", "mcp:server-a");

        assert_eq!(registry.consumers_of("bun"), vec!["builtin:ext-builder"]);
    }

    #[test]
    fn runtime_manager_consumers_of_is_empty_when_nothing_registered() {
        let manager = RuntimeManager::new();
        assert_eq!(manager.consumers_of("bun"), Vec::<String>::new());
    }

    #[test]
    fn runtime_manager_consumers_of_lists_every_registered_consumer() {
        let manager = RuntimeManager::new();
        manager.add_consumer("bun", "mcp:server-a");
        manager.add_consumer("bun", "builtin:ext-builder");

        let mut consumers = manager.consumers_of("bun");
        consumers.sort();
        assert_eq!(consumers, vec!["builtin:ext-builder", "mcp:server-a"]);
    }

    #[test]
    fn runtime_manager_consumers_of_updates_after_remove_consumer() {
        let manager = RuntimeManager::new();
        manager.add_consumer("bun", "mcp:server-a");
        manager.add_consumer("bun", "builtin:ext-builder");
        manager.remove_consumer("bun", "mcp:server-a");

        assert_eq!(manager.consumers_of("bun"), vec!["builtin:ext-builder"]);
    }

    // ── Re-download verification: removing a runtime must let a later
    // `ensure()` on the same manager report NeedsDownload again, not error or
    // stay stuck reporting Installed from some cached state.

    #[test]
    fn ensure_reports_needs_download_again_after_remove() {
        let tmp = tempfile::TempDir::new().unwrap();
        // Simulate `<app_data_dir>/runtimes` directly against the pure
        // `remove_from_root`/`installed_binary_path` cores rather than a
        // real AppHandle (which `ensure()`/`remove()` need but which isn't
        // constructible in a unit test) — this still exercises the same "no
        // cached installed flag anywhere" guarantee those methods rely on.
        let root = tmp.path().join("runtimes");
        let bun_dir = root.join("bun").join("1.1.0");
        std::fs::create_dir_all(&bun_dir).unwrap();
        std::fs::write(bun_dir.join("bun"), b"binary").unwrap();

        assert!(installed_binary_path(&root, "bun").is_some());

        remove_from_root(&root, "bun").unwrap();

        assert_eq!(
            installed_binary_path(&root, "bun"),
            None,
            "after remove, resolution must report absent so ensure()'s NeedsDownload path re-triggers, not an error"
        );
    }

    #[test]
    fn resolve_with_lookup_returns_installed_path_when_present() {
        let path = resolve_with_lookup("bun", |name| {
            (name == "bun").then(|| PathBuf::from("/app-data/runtimes/bun/1.1.0/bun"))
        });
        assert_eq!(
            path,
            Some(PathBuf::from("/app-data/runtimes/bun/1.1.0/bun"))
        );
    }

    #[test]
    fn resolve_with_lookup_returns_none_when_not_installed() {
        let path = resolve_with_lookup("ffmpeg", |_| None);
        assert_eq!(path, None);
    }

    #[test]
    fn ensure_with_lookup_returns_installed_when_already_present() {
        let result = ensure_with_lookup(
            "bun",
            |_| Some(PathBuf::from("/app-data/runtimes/bun/1.1.0/bun")),
            |_| 0,
        );
        assert_eq!(
            result,
            EnsureResult::Installed(PathBuf::from("/app-data/runtimes/bun/1.1.0/bun"))
        );
    }

    #[test]
    fn ensure_with_lookup_returns_needs_download_with_size_when_absent() {
        let result = ensure_with_lookup(
            "ffmpeg",
            |_| None,
            |name| {
                assert_eq!(name, "ffmpeg");
                55_000_000
            },
        );
        assert_eq!(
            result,
            EnsureResult::NeedsDownload {
                size_bytes: 55_000_000
            }
        );
    }

    // ── Fix 1: path traversal guard ─────────────────────────────────────────

    #[test]
    fn validate_runtime_name_rejects_empty() {
        assert!(validate_runtime_name("").is_err());
        assert!(validate_runtime_name("   ").is_err());
    }

    #[test]
    fn validate_runtime_name_rejects_parent_dir_traversal() {
        assert!(validate_runtime_name("../../evil").is_err());
        assert!(validate_runtime_name("bun/../../etc").is_err());
    }

    #[test]
    fn validate_runtime_name_rejects_absolute_path() {
        assert!(validate_runtime_name("/etc").is_err());
    }

    #[test]
    fn validate_runtime_name_accepts_normal_name() {
        assert!(validate_runtime_name("bun").is_ok());
    }

    #[test]
    fn remove_from_root_rejects_path_traversal_name_and_leaves_outside_dir_untouched() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("runtimes");
        std::fs::create_dir_all(&root).unwrap();

        // A sentinel dir sitting next to `root` that a ".." traversal from
        // inside it could otherwise reach.
        let sentinel = tmp.path().join("evil-sentinel");
        std::fs::create_dir_all(&sentinel).unwrap();
        std::fs::write(sentinel.join("keep.txt"), b"must survive").unwrap();

        let result = remove_from_root(&root, "../evil-sentinel");

        assert!(result.is_err(), "traversal name must be rejected");
        assert!(
            sentinel.join("keep.txt").exists(),
            "sentinel dir outside the runtimes root must survive untouched"
        );
    }

    #[test]
    fn remove_from_root_rejects_absolute_path_name_and_leaves_it_untouched() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("runtimes");
        std::fs::create_dir_all(&root).unwrap();

        let sentinel = tempfile::TempDir::new().unwrap();
        std::fs::write(sentinel.path().join("keep.txt"), b"must survive").unwrap();

        let result = remove_from_root(&root, sentinel.path().to_str().unwrap());

        assert!(result.is_err(), "absolute-path name must be rejected");
        assert!(sentinel.path().join("keep.txt").exists());
    }

    #[test]
    fn remove_from_root_removes_an_installed_runtime_by_valid_name() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("runtimes");
        let bun_dir = root.join("bun").join("1.1.0");
        std::fs::create_dir_all(&bun_dir).unwrap();
        std::fs::write(bun_dir.join("bun"), b"binary").unwrap();

        let result = remove_from_root(&root, "bun");

        assert!(result.is_ok());
        assert!(!root.join("bun").exists());
    }

    #[test]
    fn installed_binary_path_returns_none_for_path_traversal_name() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("runtimes");
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(installed_binary_path(&root, "../../evil"), None);
    }

    #[test]
    fn installed_binary_path_returns_none_for_absolute_name() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("runtimes");
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(installed_binary_path(&root, "/etc"), None);
    }

    // ── Fix 3: concurrent-download locking ──────────────────────────────────

    #[test]
    fn download_lock_for_returns_the_same_lock_for_the_same_name() {
        let manager = RuntimeManager::new();
        let a = manager.download_lock_for("bun");
        let b = manager.download_lock_for("bun");
        assert!(
            std::sync::Arc::ptr_eq(&a, &b),
            "repeated calls for the same runtime name must share one lock"
        );
    }

    #[test]
    fn download_lock_for_returns_independent_locks_for_different_names() {
        let manager = RuntimeManager::new();
        let bun_lock = manager.download_lock_for("bun");
        let uv_lock = manager.download_lock_for("uv");
        assert!(
            !std::sync::Arc::ptr_eq(&bun_lock, &uv_lock),
            "different runtime names must not share a lock"
        );
    }

    // ── Fix 4: dir_size must not follow symlinks ────────────────────────────

    #[cfg(unix)]
    #[test]
    fn dir_size_does_not_count_a_symlinks_target_size() {
        let tmp = tempfile::TempDir::new().unwrap();
        let dir = tmp.path().join("runtime-version");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bin"), [0u8; 10]).unwrap();

        // A symlink inside the sized directory pointing at a much larger
        // file elsewhere — following it would wrongly inflate the total.
        let elsewhere = tmp.path().join("elsewhere.bin");
        std::fs::write(&elsewhere, [0u8; 999]).unwrap();
        std::os::unix::fs::symlink(&elsewhere, dir.join("link-to-elsewhere")).unwrap();

        let total = dir_size(&dir);

        assert_eq!(
            total, 10,
            "a symlink's target size must never be counted (nor its target followed)"
        );
    }

    // ── Fix 7 + 8: shared artifact resolution, diagnosable version errors ──

    fn fixture_catalog_with_single_bun_version() -> catalog::RuntimeCatalog {
        let platform_key =
            catalog::resolve_platform_key(std::env::consts::OS, std::env::consts::ARCH).unwrap();
        let mut platforms = HashMap::new();
        platforms.insert(
            platform_key.to_string(),
            catalog::PlatformArtifact {
                url: "https://example.com/bun.zip".to_string(),
                sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
                    .to_string(),
                archive_format: catalog::ArchiveFormat::Zip,
                binary_path_in_archive: Some("bun".to_string()),
            },
        );
        let mut versions = HashMap::new();
        versions.insert("1.1.0".to_string(), platforms);
        let mut runtimes = HashMap::new();
        runtimes.insert("bun".to_string(), catalog::RuntimeEntry { versions });
        catalog::RuntimeCatalog { runtimes }
    }

    #[test]
    fn resolve_artifact_from_catalog_is_deterministic_for_identical_inputs() {
        // `remote_download_size` and `download_inner` both resolve through
        // this same pure function — if they ever diverge from each other
        // it can only be a real catalog change between two IPC calls, not
        // a bug in duplicated resolution logic.
        let fallback = fixture_catalog_with_single_bun_version();

        let a = resolve_artifact_from_catalog(None, &fallback, "bun").unwrap();
        let b = resolve_artifact_from_catalog(None, &fallback, "bun").unwrap();

        assert_eq!(a, b);
        assert_eq!(a.0, "1.1.0");
    }

    #[test]
    fn resolve_artifact_from_catalog_errors_for_unknown_runtime() {
        let fallback = catalog::RuntimeCatalog {
            runtimes: HashMap::new(),
        };
        let err = resolve_artifact_from_catalog(None, &fallback, "does-not-exist").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "got: {err:?}");
    }

    #[test]
    fn resolve_artifact_from_catalog_error_mentions_unparseable_version_not_generic_message() {
        let mut versions = HashMap::new();
        versions.insert("2025.01.15".to_string(), HashMap::new());
        let mut runtimes = HashMap::new();
        runtimes.insert("yt-dlp".to_string(), catalog::RuntimeEntry { versions });
        let fallback = catalog::RuntimeCatalog { runtimes };

        let err = resolve_artifact_from_catalog(None, &fallback, "yt-dlp").unwrap_err();

        let msg = err.to_string();
        assert!(
            msg.contains("2025.01.15"),
            "error must mention the unparseable version string, got: {msg}"
        );
    }

    #[test]
    fn latest_version_picks_the_highest_semver_when_all_parse() {
        let mut versions = HashMap::new();
        versions.insert("1.0.0".to_string(), HashMap::new());
        versions.insert("1.2.0".to_string(), HashMap::new());
        versions.insert("1.1.5".to_string(), HashMap::new());
        let entry = catalog::RuntimeEntry { versions };

        assert_eq!(latest_version(&entry).unwrap(), "1.2.0");
    }

    #[test]
    fn latest_version_errors_with_unparseable_versions_listed_when_none_parse() {
        let mut versions = HashMap::new();
        versions.insert("2025.01.15".to_string(), HashMap::new());
        let entry = catalog::RuntimeEntry { versions };

        let err = latest_version(&entry).unwrap_err();
        assert!(
            err.contains("2025.01.15"),
            "error must mention the unparseable version string, got: {err}"
        );
    }

    #[test]
    fn latest_version_errors_generically_when_there_are_no_versions_at_all() {
        let entry = catalog::RuntimeEntry {
            versions: HashMap::new(),
        };
        let err = latest_version(&entry).unwrap_err();
        assert!(err.contains("no published versions"), "got: {err}");
    }

    // ── missing_of_with: the generalized form of
    // ext_builder::process::missing_runtimes_with, shared across an
    // arbitrary declared-runtime list instead of the hardcoded bun/claude
    // pair. Characterization tests mirroring that module's existing
    // coverage, so the extraction can't silently change behavior.

    struct RecordingSizeLookup {
        calls: Mutex<Vec<String>>,
        sizes: HashMap<&'static str, Option<u64>>,
    }

    impl RecordingSizeLookup {
        fn new(sizes: &[(&'static str, Option<u64>)]) -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                sizes: sizes.iter().cloned().collect(),
            }
        }
    }

    #[async_trait::async_trait]
    impl RuntimeSizeLookup for RecordingSizeLookup {
        async fn needs_download(&self, name: &str) -> Result<Option<u64>, AppError> {
            self.calls.lock().unwrap().push(name.to_string());
            Ok(self.sizes.get(name).copied().flatten())
        }
    }

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[tokio::test]
    async fn missing_of_with_reports_every_name_the_resolver_cannot_resolve() {
        let lookup = RecordingSizeLookup::new(&[("bun", Some(10)), ("claude", Some(20))]);
        let result = missing_of_with(&names(&["bun", "claude"]), |_| None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![
                MissingRuntime {
                    name: "bun".to_string(),
                    size_bytes: 10
                },
                MissingRuntime {
                    name: "claude".to_string(),
                    size_bytes: 20
                },
            ]
        );
    }

    #[tokio::test]
    async fn missing_of_with_reports_only_the_unresolved_names() {
        let lookup = RecordingSizeLookup::new(&[("claude", Some(20))]);
        let result = missing_of_with(
            &names(&["bun", "claude"]),
            |n| (n == "bun").then(|| PathBuf::from("/bin/bun")),
            &lookup,
        )
        .await
        .unwrap();
        assert_eq!(
            result,
            vec![MissingRuntime {
                name: "claude".to_string(),
                size_bytes: 20
            }]
        );
    }

    #[tokio::test]
    async fn missing_of_with_never_queries_size_lookup_when_everything_resolves() {
        let lookup = RecordingSizeLookup::new(&[]);
        let result = missing_of_with(
            &names(&["bun", "claude"]),
            |n| Some(PathBuf::from(format!("/bin/{n}"))),
            &lookup,
        )
        .await
        .unwrap();
        assert_eq!(result, Vec::new());
        assert_eq!(
            lookup.calls.lock().unwrap().len(),
            0,
            "size lookup must never be consulted when nothing is missing"
        );
    }

    #[tokio::test]
    async fn missing_of_with_excludes_a_name_the_size_lookup_reports_as_already_installed() {
        let lookup = RecordingSizeLookup::new(&[("bun", None), ("claude", Some(5))]);
        let result = missing_of_with(&names(&["bun", "claude"]), |_| None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![MissingRuntime {
                name: "claude".to_string(),
                size_bytes: 5
            }]
        );
    }

    #[tokio::test]
    async fn missing_of_with_supports_an_arbitrary_declared_runtime_list_beyond_bun_and_claude() {
        // The whole point of generalizing: an extension manifest's
        // `runtimes: ["ffmpeg"]` must work here even though ext_builder's
        // fixed pair never mentions it.
        let lookup = RecordingSizeLookup::new(&[("ffmpeg", Some(55_000_000))]);
        let result = missing_of_with(&names(&["ffmpeg"]), |_| None, &lookup)
            .await
            .unwrap();
        assert_eq!(
            result,
            vec![MissingRuntime {
                name: "ffmpeg".to_string(),
                size_bytes: 55_000_000
            }]
        );
    }

    #[tokio::test]
    async fn download_lock_for_serializes_concurrent_holders_of_the_same_name() {
        let manager = RuntimeManager::new();
        let lock_a = manager.download_lock_for("bun");
        let lock_b = manager.download_lock_for("bun");

        let order = std::sync::Arc::new(Mutex::new(Vec::<&'static str>::new()));

        let guard = lock_a.lock().await;
        let order2 = order.clone();
        let waiter = tokio::spawn(async move {
            // Blocks until `guard` (held by the first "download") is dropped.
            let _g = lock_b.lock().await;
            order2.lock().unwrap().push("second");
        });

        // Give the spawned task a chance to actually start waiting on the
        // lock before we record "first" and release it.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        order.lock().unwrap().push("first");
        drop(guard);

        waiter.await.unwrap();

        assert_eq!(
            *order.lock().unwrap(),
            vec!["first", "second"],
            "the second caller must not proceed until the first releases the lock"
        );
    }
}
