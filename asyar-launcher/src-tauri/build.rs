use std::path::PathBuf;

fn main() {
    let base_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());

    // Expose the build-time target triple to the crate so process.rs can locate
    // the `tauri dev` sidecar/binary layout (`binaries/<name>-<triple>`). Baked
    // at compile time; in a shipped binary the production resource paths match
    // first so this dev path is never used.
    println!(
        "cargo:rustc-env=TARGET_TRIPLE={}",
        std::env::var("TARGET").expect("TARGET env var not set")
    );
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
    let sidecar_js_source =
        base_dir.join("../../asyar-ext-builder/dist/sidecar.js");
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
        std::fs::write(&sidecar_js_staging, b"")
            .expect("Failed to create placeholder sidecar.js");
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

    // Ensure external binaries (sidecars) exist for the target triple during non-release builds.
    // During tests or CI, they might not be downloaded. Creating empty dummy files prevents
    // tauri_build from panicking. In release mode, we let it panic to prevent shipping empty sidecars.
    let profile = std::env::var("PROFILE").unwrap_or_default();
    if profile != "release" {
        let target = std::env::var("TARGET").expect("TARGET env var not set");
        let binaries_dir = base_dir.join("binaries");
        let ext = if target.contains("windows") {
            ".exe"
        } else {
            ""
        };

        let _ = std::fs::create_dir_all(&binaries_dir);
        for sidecar in &["bun", "uv", "claude"] {
            let path = binaries_dir.join(format!("{}-{}{}", sidecar, target, ext));
            if !path.exists() {
                std::fs::File::create(&path).unwrap_or_else(|_| {
                    panic!(
                        "build.rs failed to create dummy sidecar placeholder at {:?}",
                        path
                    )
                });
                println!(
                    "cargo:warning=Created dummy sidecar placeholder at {}",
                    path.display()
                );
            }
        }
    }

    tauri_build::build()
}

/// Recursively copy the capability spec tree, skipping dev-only `*.test.ts`
/// files which must not ship in the bundled resource.
fn copy_capability_spec(src: &std::path::Path, dest: &std::path::Path) {
    let entries = std::fs::read_dir(src)
        .unwrap_or_else(|e| panic!("build.rs failed to read capabilitySpec dir {:?}: {}", src, e));

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
                panic!("Failed to copy capabilitySpec file {:?} -> {:?}", path, target)
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
