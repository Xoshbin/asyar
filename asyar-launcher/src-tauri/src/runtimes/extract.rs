//! Runtime archive extraction: zip, tar.gz, and raw (no archive) binaries.

use crate::error::AppError;
use std::path::{Component, Path};

/// Extracts `zip_path` into `dest_dir`. Delegates to the extension
/// installer's zip extractor — same zip-slip guard, same recursive
/// directory-write behavior — rather than re-implementing it here.
pub(crate) async fn extract_zip(zip_path: &Path, dest_dir: &Path) -> Result<(), AppError> {
    crate::extensions::installer::extract_zip(zip_path, dest_dir).await
}

/// Extracts a gzip-compressed tar archive into `dest_dir`, rejecting any
/// entry whose path contains a `..` component or is absolute (the tar.gz
/// equivalent of the zip-slip guard in `extract_zip`).
///
/// Extraction itself goes through `Entry::unpack_in`, tar-rs's own
/// safety-checked unpacker: it canonicalizes each resolved write path and
/// verifies it stays inside `dest_dir`, which is what defeats a
/// symlink-then-write-through escape (a symlink entry pointing outside
/// `dest_dir`, followed by an entry that writes through it) that a purely
/// component-based `..` check cannot catch on its own.
pub(crate) fn extract_tar_gz(archive_path: &Path, dest_dir: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(dest_dir)?;

    let file = std::fs::File::open(archive_path)?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);

    for entry_result in archive.entries()? {
        let mut entry = entry_result?;
        let entry_path = entry.path()?.into_owned();

        // [SECURITY] tar-slip guard: reject any entry whose path components
        // include `..`, or that is absolute. `unpack_in` below would only
        // silently strip a leading `/` and treat the rest as relative to
        // `dest_dir` rather than reject it outright, so this explicit
        // up-front check is stricter than relying on it alone.
        let has_parent_dir_component = entry_path
            .components()
            .any(|c| matches!(c, Component::ParentDir));
        if has_parent_dir_component || entry_path.is_absolute() {
            return Err(AppError::Validation(format!(
                "Tar entry '{}' contains a path traversal sequence and was rejected",
                entry_path.display()
            )));
        }

        // `Ok(false)` means tar-rs's own safety check skipped the entry
        // (e.g. it resolves outside `dest_dir`) rather than an IO error —
        // treat that as a rejection too. A resolved-but-outside-dest_dir
        // write (the symlink-escape case) surfaces as an `Err` from
        // `validate_inside_dst` and propagates via `?`.
        let unpacked = entry.unpack_in(dest_dir)?;
        if !unpacked {
            return Err(AppError::Validation(format!(
                "Tar entry '{}' was rejected by the archive extractor's safety check",
                entry_path.display()
            )));
        }
    }

    Ok(())
}

/// Copies a runtime binary that ships with no archive at all (e.g. the
/// `claude` release, distributed as a bare executable).
pub(crate) fn copy_raw(src: &Path, dest: &Path) -> Result<(), AppError> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(src, dest)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_zip::tokio::write::ZipFileWriter;
    use async_zip::{Compression, ZipEntryBuilder};
    use flate2::write::GzEncoder;
    use flate2::Compression as GzCompression;
    use tempfile::{NamedTempFile, TempDir};
    use tokio::fs::File as TokioFile;

    async fn make_zip(entries: &[(&str, &[u8])]) -> NamedTempFile {
        let zip_tmp = NamedTempFile::new().unwrap();
        let zip_file = TokioFile::create(zip_tmp.path()).await.unwrap();
        let mut writer = ZipFileWriter::with_tokio(zip_file);
        for (name, content) in entries {
            let entry = ZipEntryBuilder::new((*name).into(), Compression::Deflate);
            writer.write_entry_whole(entry, content).await.unwrap();
        }
        writer.close().await.unwrap();
        zip_tmp
    }

    fn make_tar_gz(entries: &[(&str, &[u8])]) -> NamedTempFile {
        let tar_tmp = NamedTempFile::new().unwrap();
        let gz = GzEncoder::new(
            std::fs::File::create(tar_tmp.path()).unwrap(),
            GzCompression::default(),
        );
        let mut builder = tar::Builder::new(gz);
        for (name, content) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            // `append_data`/`Header::set_path` refuse to write a `..`
            // component at all (a tar-rs hardening) — write the raw name
            // bytes directly via the shared `name` field so this fixture
            // helper can still construct a path-traversal archive, which is
            // exactly what `extract_tar_gz_rejects_path_traversal_entry`
            // needs to exercise `extract_tar_gz`'s own guard.
            let name_bytes = name.as_bytes();
            header.as_old_mut().name[..name_bytes.len()].copy_from_slice(name_bytes);
            header.set_cksum();
            builder.append(&header, *content).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
        tar_tmp
    }

    #[tokio::test]
    async fn extract_zip_happy_path_writes_files() {
        let zip = make_zip(&[("bun", b"binary-content")]).await;
        let dest = TempDir::new().unwrap();

        extract_zip(zip.path(), dest.path()).await.unwrap();

        assert!(dest.path().join("bun").exists());
    }

    #[tokio::test]
    async fn extract_zip_rejects_path_traversal_entry() {
        let zip = make_zip(&[("../../evil", b"evil")]).await;
        let dest = TempDir::new().unwrap();

        let result = extract_zip(zip.path(), dest.path()).await;

        assert!(
            result.is_err(),
            "zip entries containing '..' must be rejected"
        );
    }

    #[test]
    fn extract_tar_gz_happy_path_writes_files() {
        let archive = make_tar_gz(&[("uv", b"uv-binary-content")]);
        let dest = TempDir::new().unwrap();

        extract_tar_gz(archive.path(), dest.path()).unwrap();

        assert!(dest.path().join("uv").exists());
        assert_eq!(
            std::fs::read(dest.path().join("uv")).unwrap(),
            b"uv-binary-content"
        );
    }

    #[test]
    fn extract_tar_gz_rejects_path_traversal_entry() {
        let archive = make_tar_gz(&[("../../evil", b"evil")]);
        let dest = TempDir::new().unwrap();

        let result = extract_tar_gz(archive.path(), dest.path());

        assert!(
            result.is_err(),
            "tar.gz entries containing '..' must be rejected"
        );
    }

    #[test]
    fn extract_tar_gz_rejects_absolute_path_entry() {
        let archive = make_tar_gz(&[("/tmp/evil-absolute", b"evil")]);
        let dest = TempDir::new().unwrap();

        let result = extract_tar_gz(archive.path(), dest.path());

        assert!(
            result.is_err(),
            "tar.gz entries with an absolute path must be rejected"
        );
        assert!(
            !Path::new("/tmp/evil-absolute").exists(),
            "an absolute-path entry must never be written to its literal path"
        );
    }

    #[cfg(unix)]
    #[test]
    fn extract_tar_gz_rejects_symlink_escape_write_through() {
        // Entry 1: a symlink named `link` inside the archive that points at
        // a real directory OUTSIDE `dest`. Entry 2: a regular file written
        // through `link/evil.txt` — if extraction followed the symlink this
        // would land outside `dest` entirely.
        let outside = TempDir::new().unwrap();
        let dest = TempDir::new().unwrap();

        let tar_tmp = NamedTempFile::new().unwrap();
        let gz = GzEncoder::new(
            std::fs::File::create(tar_tmp.path()).unwrap(),
            GzCompression::default(),
        );
        let mut builder = tar::Builder::new(gz);

        let mut symlink_header = tar::Header::new_gnu();
        symlink_header.set_entry_type(tar::EntryType::Symlink);
        symlink_header.set_size(0);
        symlink_header.set_mode(0o777);
        builder
            .append_link(&mut symlink_header, "link", outside.path())
            .unwrap();

        let mut file_header = tar::Header::new_gnu();
        file_header.set_size(4);
        file_header.set_mode(0o644);
        builder
            .append_data(&mut file_header, "link/evil.txt", &b"evil"[..])
            .unwrap();

        builder.into_inner().unwrap().finish().unwrap();

        let result = extract_tar_gz(tar_tmp.path(), dest.path());

        assert!(
            result.is_err(),
            "a write-through-symlink entry that escapes dest must be rejected"
        );
        assert!(
            !outside.path().join("evil.txt").exists(),
            "the write must never land outside dest via the symlink"
        );
    }

    #[test]
    fn copy_raw_copies_file_without_extraction() {
        let src = NamedTempFile::new().unwrap();
        std::fs::write(src.path(), b"claude-binary-bytes").unwrap();
        let dest_dir = TempDir::new().unwrap();
        let dest_path = dest_dir.path().join("claude");

        copy_raw(src.path(), &dest_path).unwrap();

        assert!(dest_path.exists());
        assert_eq!(std::fs::read(&dest_path).unwrap(), b"claude-binary-bytes");
    }
}
