use crate::error::AppError;
use async_zip::tokio::read::seek::ZipFileReader;
use async_zip::tokio::write::ZipFileWriter;
use async_zip::{Compression, ZipEntryBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path};
use tokio::fs::File as TokioFile;
use tokio::io::BufReader;
use tokio::io::AsyncReadExt;
use tokio_util::compat::FuturesAsyncReadCompatExt;

/// A single category entry to be packed into the archive.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CategoryEntry {
    pub filename: String,
    pub json_content: String,
    pub sensitive_field_paths: Vec<String>,
}

/// A binary asset to include in the archive.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AssetEntry {
    pub archive_path: String,
    pub source_path: String,
}

/// The structured contents returned after unpacking an archive.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ArchiveContents {
    pub manifest_json: String,
    pub category_files: HashMap<String, String>,
    pub asset_paths: Vec<String>,
}

// Security: reject path traversal, absolute paths, and Windows drive prefixes
fn is_safe_archive_path(filename: &str) -> bool {
    Path::new(filename).components().all(|c| matches!(c, Component::Normal(_)))
}

pub async fn pack_archive(
    manifest_json: &str,
    categories: &[CategoryEntry],
    binary_assets: &[AssetEntry],
    destination: &str,
) -> Result<(), AppError> {
    let file = TokioFile::create(destination).await?;
    let mut writer = ZipFileWriter::with_tokio(file);

    // Write manifest.json
    let entry = ZipEntryBuilder::new("manifest.json".into(), Compression::Deflate);
    writer
        .write_entry_whole(entry, manifest_json.as_bytes())
        .await
        .map_err(|e| AppError::Extension(format!("Failed to write manifest: {}", e)))?;

    // Write each category JSON file
    for cat in categories {
        let entry = ZipEntryBuilder::new(cat.filename.clone().into(), Compression::Deflate);
        writer
            .write_entry_whole(entry, cat.json_content.as_bytes())
            .await
            .map_err(|e| {
                AppError::Extension(format!("Failed to write {}: {}", cat.filename, e))
            })?;
    }

    // Write binary assets
    for asset in binary_assets {
        let data = tokio::fs::read(&asset.source_path).await.map_err(|e| {
            AppError::Extension(format!(
                "Failed to read asset {}: {}",
                asset.source_path, e
            ))
        })?;
        let entry = ZipEntryBuilder::new(asset.archive_path.clone().into(), Compression::Deflate);
        writer.write_entry_whole(entry, &data).await.map_err(|e| {
            AppError::Extension(format!("Failed to write asset {}: {}", asset.archive_path, e))
        })?;
    }

    writer
        .close()
        .await
        .map_err(|e| AppError::Extension(format!("Failed to finalize ZIP: {}", e)))?;

    Ok(())
}

pub async fn unpack_archive(path: &str) -> Result<ArchiveContents, AppError> {
    let file = TokioFile::open(path).await?;
    let buf_reader = BufReader::new(file);
    let mut zip = ZipFileReader::with_tokio(buf_reader)
        .await
        .map_err(|e| AppError::Extension(format!("Failed to open ZIP: {}", e)))?;

    let mut manifest_json = String::new();
    let mut category_files: HashMap<String, String> = HashMap::new();
    let mut asset_paths: Vec<String> = Vec::new();

    let entry_count = zip.file().entries().len();

    for index in 0..entry_count {
        let filename = {
            let entry = &zip.file().entries()[index];
            let raw = entry
                .filename()
                .as_str()
                .map_err(|e| AppError::Extension(format!("Invalid filename encoding: {}", e)))?;
            raw.to_string()
        };

        // Security: reject path traversal, absolute paths, and Windows drive prefixes
        if !is_safe_archive_path(&filename) {
            return Err(AppError::Validation(format!(
                "Archive entry '{}' contains an unsafe path",
                filename
            )));
        }

        // Assets: record path, skip reading content
        if filename.starts_with("assets/") {
            asset_paths.push(filename);
            continue;
        }

        // Read entry content
        let entry_reader = zip
            .reader_without_entry(index)
            .await
            .map_err(|e| AppError::Extension(format!("Failed to open entry {}: {}", filename, e)))?;

        let mut buf = Vec::new();
        entry_reader
            .compat()
            .read_to_end(&mut buf)
            .await
            .map_err(AppError::Io)?;

        let content = String::from_utf8(buf)
            .map_err(|e| AppError::Extension(format!("Entry {} is not valid UTF-8: {}", filename, e)))?;

        if filename == "manifest.json" {
            manifest_json = content;
        } else {
            category_files.insert(filename, content);
        }
    }

    if manifest_json.is_empty() {
        return Err(AppError::Validation(
            "Archive missing manifest.json".into(),
        ));
    }

    Ok(ArchiveContents {
        manifest_json,
        category_files,
        asset_paths,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn pack_and_unpack_round_trip() {
        let dir = TempDir::new().unwrap();
        let zip_path = dir.path().join("test.asyar");
        let zip_str = zip_path.to_str().unwrap();

        let manifest = r#"{"formatVersion":1,"categories":[]}"#;
        let categories = vec![
            CategoryEntry {
                filename: "settings.json".to_string(),
                json_content: r#"{"theme":"dark"}"#.to_string(),
                sensitive_field_paths: vec![],
            },
            CategoryEntry {
                filename: "snippets.json".to_string(),
                json_content: r#"[{"id":"1","name":"test"}]"#.to_string(),
                sensitive_field_paths: vec![],
            },
        ];

        pack_archive(manifest, &categories, &[], zip_str)
            .await
            .unwrap();

        assert!(zip_path.exists());

        let contents = unpack_archive(zip_str).await.unwrap();
        assert_eq!(contents.manifest_json, manifest);
        assert_eq!(
            contents.category_files.get("settings.json").unwrap(),
            r#"{"theme":"dark"}"#
        );
        assert_eq!(
            contents.category_files.get("snippets.json").unwrap(),
            r#"[{"id":"1","name":"test"}]"#
        );
    }

    #[tokio::test]
    async fn pack_with_binary_assets() {
        let dir = TempDir::new().unwrap();

        // Create a fake image file
        let img_path = dir.path().join("test-img.png");
        tokio::fs::write(&img_path, b"fake-png-data").await.unwrap();

        let zip_path = dir.path().join("test.asyar");
        let zip_str = zip_path.to_str().unwrap();

        let manifest = r#"{"formatVersion":1}"#;
        let assets = vec![AssetEntry {
            archive_path: "assets/clipboard/img1.png".to_string(),
            source_path: img_path.to_str().unwrap().to_string(),
        }];

        pack_archive(manifest, &[], &assets, zip_str).await.unwrap();

        let contents = unpack_archive(zip_str).await.unwrap();
        assert!(contents.asset_paths.contains(&"assets/clipboard/img1.png".to_string()));
    }

    #[tokio::test]
    async fn path_traversal_rejected() {
        let dir = TempDir::new().unwrap();
        let zip_path = dir.path().join("traversal.asyar");
        let zip_str = zip_path.to_str().unwrap();

        // Craft a ZIP with a path traversal entry
        let file = TokioFile::create(zip_str).await.unwrap();
        let mut writer = ZipFileWriter::with_tokio(file);

        // Add a manifest so we pass that check first
        let manifest_entry = ZipEntryBuilder::new("manifest.json".into(), Compression::Deflate);
        writer.write_entry_whole(manifest_entry, b"{}").await.unwrap();

        // Add the malicious entry
        let evil_entry = ZipEntryBuilder::new("../../../evil.json".into(), Compression::Deflate);
        writer.write_entry_whole(evil_entry, b"{}").await.unwrap();
        writer.close().await.unwrap();

        let result = unpack_archive(zip_str).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("unsafe path"));
    }

    #[tokio::test]
    async fn missing_manifest_fails() {
        let dir = TempDir::new().unwrap();
        let zip_path = dir.path().join("no-manifest.asyar");
        let zip_str = zip_path.to_str().unwrap();

        // Create a zip without a manifest entry
        let file = TokioFile::create(zip_str).await.unwrap();
        let mut writer = ZipFileWriter::with_tokio(file);
        let entry = ZipEntryBuilder::new("random.json".into(), Compression::Deflate);
        writer
            .write_entry_whole(entry, b"{}")
            .await
            .unwrap();
        writer.close().await.unwrap();

        let result = unpack_archive(zip_str).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("manifest"));
    }
}
