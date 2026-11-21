#[path = "../build_support/builtin_features.rs"]
mod builtin_features;

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn stages_manifests_and_complete_asset_trees() {
    let temp_dir = std::env::temp_dir().join(format!(
        "asyar-builtin-staging-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let source = temp_dir.join("source");
    let staged = temp_dir.join("staged");
    let feature = source.join("agents");
    fs::create_dir_all(feature.join("assets/nested")).unwrap();
    fs::create_dir_all(source.join("no-assets")).unwrap();
    fs::create_dir_all(source.join("no-manifest/assets")).unwrap();
    fs::create_dir_all(&staged).unwrap();
    fs::write(feature.join("manifest.json"), b"manifest").unwrap();
    fs::write(feature.join("assets/icon.png"), b"icon").unwrap();
    fs::write(feature.join("assets/nested/icon.svg"), b"nested").unwrap();
    fs::write(feature.join("source.ts"), b"source").unwrap();
    fs::write(source.join("no-assets/manifest.json"), b"other").unwrap();
    fs::write(source.join("no-manifest/assets/icon.png"), b"ignored").unwrap();
    fs::write(staged.join("stale"), b"stale").unwrap();

    builtin_features::stage_builtin_features(&source, &staged);

    for (path, contents) in [
        ("agents/manifest.json", b"manifest".as_slice()),
        ("agents/assets/icon.png", b"icon"),
        ("agents/assets/nested/icon.svg", b"nested"),
        ("no-assets/manifest.json", b"other"),
    ] {
        assert_eq!(fs::read(staged.join(path)).unwrap(), contents, "{path}");
    }
    for path in ["stale", "agents/source.ts", "no-manifest"] {
        assert!(!staged.join(path).exists(), "{path}");
    }

    fs::remove_dir_all(temp_dir).unwrap();
}
