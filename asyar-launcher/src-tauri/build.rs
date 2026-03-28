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

    tauri_build::build()
}
