use std::path::PathBuf;

fn main() {
    let base_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
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
                std::fs::create_dir_all(&target_dir)
                    .unwrap_or_else(|_| panic!("Failed to create staging dir for {}", feature_name));

                let manifest_dest = target_dir.join("manifest.json");
                std::fs::copy(&manifest_src, &manifest_dest)
                    .unwrap_or_else(|_| panic!("Failed to copy manifest.json for {}", feature_name));

                println!("Staged manifest.json for: {}", feature_name);
            }
        }
    }

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

    tauri_build::build()
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
        .unwrap_or_else(|| {
            panic!(
                "build.rs could not find a \"version\" field in {:?}",
                path
            )
        });

    if semver::Version::parse(&version).is_err() {
        panic!(
            "build.rs read invalid semver \"{}\" from {:?}",
            version, path
        );
    }

    version
}
