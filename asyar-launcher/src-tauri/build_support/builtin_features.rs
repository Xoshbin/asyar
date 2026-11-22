use std::path::Path;

pub fn stage_builtin_features(features_source_dir: &Path, staging_dir: &Path) {
    // Clean previous staging area
    if staging_dir.exists() {
        let _ = std::fs::remove_dir_all(staging_dir);
    }
    std::fs::create_dir_all(staging_dir).expect("Failed to create staging directory");

    // Copy manifests and their assets from each feature
    if let Ok(entries) = std::fs::read_dir(features_source_dir) {
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

                let assets_src = path.join("assets");
                if assets_src.exists() {
                    copy_assets(&assets_src, &target_dir.join("assets"));
                }

                println!("Staged manifest.json for: {}", feature_name);
            }
        }
    }
}

fn copy_assets(src: &Path, dest: &Path) {
    std::fs::create_dir_all(dest)
        .unwrap_or_else(|e| panic!("Failed to create asset staging dir {:?}: {}", dest, e));
    for entry in std::fs::read_dir(src)
        .unwrap_or_else(|e| panic!("Failed to read assets dir {:?}: {}", src, e))
    {
        let entry = entry.expect("Failed to read asset entry");
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_assets(&path, &target);
        } else {
            std::fs::copy(&path, &target).unwrap_or_else(|e| {
                panic!("Failed to copy asset {:?} -> {:?}: {}", path, target, e)
            });
        }
    }
}
