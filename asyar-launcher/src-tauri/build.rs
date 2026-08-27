use std::path::PathBuf;

fn main() {
    let base_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

    omit_missing_linux_external_binary(&base_dir);

    // Expose the build-time target triple to the crate so process.rs can locate
    // the `tauri dev` sidecar/binary layout (`binaries/<name>-<triple>`). Baked
    // at compile time; in a shipped binary the production resource paths match
    // first so this dev path is never used.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("TARGET env var not set")
    );
    println!("cargo:rerun-if-env-changed=ASYAR_KEYCHAIN_SERVICE");
    if let Ok(service) = std::env::var("ASYAR_KEYCHAIN_SERVICE") {
        println!("cargo:rustc-env=ASYAR_KEYCHAIN_SERVICE={service}");
    }
    let features_source_dir = base_dir.join("../src/built-in-features");
    let staging_dir = base_dir.join("built-in-features");

    println!("cargo:rerun-if-changed=../src/built-in-features");

    // Clean previous staging area
    if staging_dir.exists() {
        let _ = std::fs::remove_dir_all(&staging_dir);
    }
    std::fs::create_dir_all(&staging_dir).expect("Failed to create staging directory");

    // Copy only manifest.json from each feature
    if let Ok(entries) = std::fs::read_dir(&features_source_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let feature_name = path.file_name().unwrap().to_str().unwrap();
            let manifest_src = path.join("manifest.json");

            if manifest_src.exists() {
                let target_dir = staging_dir.join(feature_name);
                std::fs::create_dir_all(&target_dir).unwrap_or_else(|_| {
                    panic!("Failed to create staging dir for {}", feature_name)
                });

                let manifest_dest = target_dir.join("manifest.json");
                std::fs::copy(&manifest_src, &manifest_dest).unwrap_or_else(|_| {
                    panic!("Failed to copy manifest.json for {}", feature_name)
                });

                println!("Staged manifest.json for: {}", feature_name);
            }
        }
    }

    // Stage the AI extension-builder sidecar JS into the bundled resource location.
    // The sidecar is a pre-bundled bun JS file; the launcher runs it via the
    // bundled `bun` sidecar (`bun dist/sidecar.js`). This replaces the old
    // `bun --compile` binary approach so the Agent SDK can spawn subprocess `claude`
    // and host its in-process MCP server (both of which compiled binaries can't do).
    let sidecar_js_source = base_dir.join("../../asyar-ext-builder/dist/sidecar.js");
    let sidecar_js_staging_dir = base_dir.join("resources/ext-builder");
    let sidecar_js_staging = sidecar_js_staging_dir.join("sidecar.js");

    println!("cargo:rerun-if-changed=../../asyar-ext-builder/dist/sidecar.js");

    if sidecar_js_staging_dir.exists() {
        let _ = std::fs::remove_dir_all(&sidecar_js_staging_dir);
    }
    std::fs::create_dir_all(&sidecar_js_staging_dir)
        .expect("Failed to create ext-builder resource staging directory");

    if sidecar_js_source.exists() {
        std::fs::copy(&sidecar_js_source, &sidecar_js_staging)
            .expect("Failed to copy sidecar.js to resource staging directory");
        println!("Staged ext-builder/sidecar.js resource");
    } else {
        // Create an empty placeholder so tauri_build doesn't fail during
        // development before `pnpm build:js` has been run in asyar-ext-builder.
        std::fs::write(&sidecar_js_staging, b"").expect("Failed to create placeholder sidecar.js");
        println!("cargo:warning=ext-builder sidecar.js not built — staged an EMPTY placeholder. Run `bun run build:js` in asyar-ext-builder before `tauri build`, or the AI extension builder will be non-functional in this bundle.");
    }

    // Stage the AI extension-builder capability spec into the bundled resource
    // location. The source-of-truth lives in the frontend tree; the sidecar reads
    // the staged copy at runtime via tauri.conf.json `resources`. Copying at build
    // time (rather than committing a duplicate) keeps the two from drifting.
    let cap_spec_source_dir =
        base_dir.join("../src/built-in-features/create-extension/ai-builder/capabilitySpec");
    let cap_spec_staging_dir = base_dir.join("resources/capabilitySpec");

    println!(
        "cargo:rerun-if-changed=../src/built-in-features/create-extension/ai-builder/capabilitySpec"
    );

    if cap_spec_staging_dir.exists() {
        let _ = std::fs::remove_dir_all(&cap_spec_staging_dir);
    }
    std::fs::create_dir_all(&cap_spec_staging_dir)
        .expect("Failed to create capabilitySpec staging directory");
    copy_capability_spec(&cap_spec_source_dir, &cap_spec_staging_dir);
    println!("Staged capabilitySpec resource");

    // Inject the SDK version from asyar-sdk/package.json so the Rust-side
    // compatibility check cannot drift from the real SDK version. A stale
    // hardcoded constant silently rejected every third-party extension whose
    // asyarSdk range targeted the real SDK version — this replaces the
    // hand-maintained constant with a build-time value from the single source
    // of truth: the resolved SDK in node_modules. This path works in the
    // monorepo workspace (symlinked) and in CI (installed from npm), unlike
    // the sibling workspace dir which only exists in the full monorepo.
    let sdk_pkg_path = base_dir
        .join("..")
        .join("node_modules")
        .join("asyar-sdk")
        .join("package.json");
    let sdk_version = read_sdk_version(&sdk_pkg_path);
    println!("cargo:rustc-env=ASYAR_SDK_VERSION={}", sdk_version);
    println!("cargo:rerun-if-changed={}", sdk_pkg_path.display());

    // Windows (MSVC): make `cargo test` loadable.
    //
    // tauri_build's default app manifest — whose entire content is the
    // Common-Controls v6 side-by-side dependency — is embedded as a compiled
    // resource that embed-resource links into *bins only*. The `cargo test`
    // harness for the lib target is not a bin: it gets no manifest, binds
    // legacy comctl32 v5, and dies at load with STATUS_ENTRYPOINT_NOT_FOUND
    // (0xc0000139) on the comctl6-only export `TaskDialogIndirect` (imported
    // transitively via tao/muda/dialog code) — before a single test runs.
    // Cargo has no directive scoped to the unit-test harness
    // (`rustc-link-arg-tests` covers only `tests/*.rs` targets), so instead:
    // drop the resource-based manifest and have the LINKER embed an identical
    // one into every product it links — app binary and test harnesses alike.
    // `/MANIFESTDEPENDENCY` reproduces the default tauri manifest 1:1.
    let is_windows_msvc = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    if is_windows_msvc {
        const COMCTL6_DEPENDENCY: &str = "type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'";
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:{COMCTL6_DEPENDENCY}");
    }

    let mut attributes = tauri_build::Attributes::new();
    if is_windows_msvc {
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}

/// Direct Cargo operations do not run Tauri's before-build hook. Suppress the
/// Linux-only sidecar when its target-specific staged file is absent; a Tauri
/// build provisions that file first and therefore preserves the sidecar in
/// both debug and release builds.
fn omit_missing_linux_external_binary(base_dir: &std::path::Path) {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
        return;
    }

    let target = std::env::var("TARGET").expect("TARGET env var not set");
    if !matches!(
        target.as_str(),
        "x86_64-unknown-linux-gnu" | "aarch64-unknown-linux-gnu"
    ) {
        return;
    }

    let staged_helper = base_dir
        .join("binaries")
        .join(format!("asyar-summon-{target}"));
    println!("cargo:rerun-if-changed={}", staged_helper.display());
    if staged_helper.is_file() {
        return;
    }

    let mut overlay = std::env::var("TAURI_CONFIG")
        .map(|value| serde_json::from_str(&value).expect("TAURI_CONFIG must be valid JSON"))
        .unwrap_or_else(|_| serde_json::json!({}));
    let overlay = overlay
        .as_object_mut()
        .expect("TAURI_CONFIG must be a JSON object");
    let bundle = overlay
        .entry("bundle")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .expect("TAURI_CONFIG bundle must be a JSON object");
    // The Linux platform config currently declares only asyar-summon, enforced
    // by external-bin-provisioning.test.mjs. JSON Merge Patch replaces arrays,
    // so an empty overlay is the narrow simple option until another sidecar is
    // deliberately added to that config.
    bundle.insert("externalBin".into(), serde_json::json!([]));

    std::env::set_var(
        "TAURI_CONFIG",
        serde_json::to_string(&overlay).expect("TAURI_CONFIG overlay must serialize"),
    );
}

/// Recursively copy the capability spec tree, skipping dev-only `*.test.ts`
/// files which must not ship in the bundled resource.
fn copy_capability_spec(src: &std::path::Path, dest: &std::path::Path) {
    let entries = std::fs::read_dir(src).unwrap_or_else(|e| {
        panic!(
            "build.rs failed to read capabilitySpec dir {:?}: {}",
            src, e
        )
    });

    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let target = dest.join(&name);

        if path.is_dir() {
            std::fs::create_dir_all(&target)
                .unwrap_or_else(|_| panic!("Failed to create staging dir {:?}", target));
            copy_capability_spec(&path, &target);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.ends_with(".test.ts"))
            .unwrap_or(false)
        {
            continue;
        } else {
            std::fs::copy(&path, &target).unwrap_or_else(|_| {
                panic!(
                    "Failed to copy capabilitySpec file {:?} -> {:?}",
                    path, target
                )
            });
        }
    }
}

fn read_sdk_version(path: &std::path::Path) -> String {
    let content = std::fs::read_to_string(path).unwrap_or_else(|e| {
        panic!(
            "build.rs failed to read asyar-sdk/package.json at {:?}: {}",
            path, e
        )
    });

    let version = content
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("\"version\":")
                .map(|rest| rest.trim().trim_end_matches(','))
                .map(|v| v.trim_matches('"').to_string())
        })
        .unwrap_or_else(|| panic!("build.rs could not find a \"version\" field in {:?}", path));

    if semver::Version::parse(&version).is_err() {
        panic!(
            "build.rs read invalid semver \"{}\" from {:?}",
            version, path
        );
    }

    version
}
