//! Runtime download + checksum verification.

use crate::error::AppError;
use futures_util::StreamExt;
use std::path::Path;
use std::time::Duration;
use tempfile::NamedTempFile;
use tokio::fs::File as TokioFile;
use tokio::io::AsyncWriteExt;

/// Default connect timeout for the download client. Deliberately NOT a full
/// request timeout — a multi-hundred-MB runtime download can legitimately
/// take much longer than this to complete, but the initial TCP+TLS
/// handshake should never hang indefinitely.
const DOWNLOAD_CONNECT_TIMEOUT_SECS: u64 = 10;

/// Builds the shared HTTP client used for streaming a runtime archive to
/// disk, bounded by a connect timeout (not a full-request timeout, which
/// would kill a large in-progress download).
pub(crate) fn build_download_client_with_connect_timeout(
    connect_timeout: Duration,
) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(connect_timeout)
        .build()
        .expect("reqwest client with a connect timeout must build")
}

/// The download client used in production: a 10s connect timeout.
pub(crate) fn build_download_client() -> reqwest::Client {
    build_download_client_with_connect_timeout(Duration::from_secs(DOWNLOAD_CONNECT_TIMEOUT_SECS))
}

/// Streams `url` to a temp file, invoking `on_progress(downloaded, total)`
/// at coarse (~1 MiB) intervals so a large runtime download doesn't flood
/// the frontend with a per-chunk event. `total` is 0 when the server omits
/// `Content-Length`.
pub(crate) async fn download_to_temp_file(
    client: &reqwest::Client,
    url: &str,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<NamedTempFile, AppError> {
    const PROGRESS_STEP_BYTES: u64 = 1_048_576;

    let temp_file = NamedTempFile::new().map_err(AppError::Io)?;
    let mut dest = TokioFile::create(temp_file.path()).await?;

    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(AppError::Network(response.error_for_status().unwrap_err()));
    }
    let total_bytes = response.content_length().unwrap_or(0);

    let mut downloaded: u64 = 0;
    let mut last_reported: u64 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result?;
        downloaded += chunk.len() as u64;
        dest.write_all(&chunk).await.map_err(AppError::Io)?;
        if downloaded - last_reported >= PROGRESS_STEP_BYTES {
            on_progress(downloaded, total_bytes);
            last_reported = downloaded;
        }
    }
    on_progress(downloaded, total_bytes);

    Ok(temp_file)
}

/// Verifies `path` against `expected_sha256`, reusing the extension
/// installer's sha256 implementation rather than recomputing it. Deletes
/// the file on mismatch so a half-verified binary can never be marked
/// usable.
pub(crate) fn verify_and_cleanup(path: &Path, expected_sha256: &str) -> Result<(), AppError> {
    match crate::extensions::installer::verify_checksum(path, expected_sha256) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(path);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    fn sha256_of(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("sha256:{:x}", hasher.finalize())
    }

    #[test]
    fn build_download_client_constructs_without_panicking() {
        let _client = build_download_client();
    }

    #[tokio::test]
    async fn download_client_with_a_short_connect_timeout_never_hangs_past_it() {
        // An address that never completes a TCP handshake — proves the
        // client's connect_timeout bounds the connection attempt. Bounded
        // by an outer `tokio::time::timeout` so a regression here fails the
        // test instead of hanging the suite.
        let client = build_download_client_with_connect_timeout(Duration::from_millis(200));

        let result = tokio::time::timeout(
            Duration::from_secs(5),
            client.get("http://10.255.255.1/").send(),
        )
        .await;

        assert!(
            result.is_ok(),
            "connect_timeout must bound the connection attempt, not hang forever"
        );
    }

    #[tokio::test]
    async fn download_client_still_completes_a_normal_local_request() {
        // Sanity check that the connect_timeout doesn't break ordinary fast
        // (loopback) connections — only genuinely stalled ones.
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                // Drain the request before responding — writing a response
                // before the client has finished sending confuses hyper's
                // connection state on some platforms.
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                );
                let _ = stream.flush();
            }
        });

        let client = build_download_client();
        let response = client
            .get(format!("http://{addr}/"))
            .send()
            .await
            .expect("a fast local server must not be rejected by connect_timeout");

        assert!(response.status().is_success());
    }

    #[test]
    fn verify_and_cleanup_passes_when_checksum_matches() {
        let content = b"fake-runtime-binary-bytes";
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content).unwrap();
        let expected = sha256_of(content);

        let result = verify_and_cleanup(file.path(), &expected);

        assert!(result.is_ok());
        assert!(
            file.path().exists(),
            "a matching checksum must leave the downloaded file in place"
        );
    }

    #[test]
    fn verify_and_cleanup_deletes_file_and_errors_on_mismatch() {
        let content = b"fake-runtime-binary-bytes";
        let file = NamedTempFile::new().unwrap();
        std::fs::write(file.path(), content).unwrap();
        let wrong_checksum =
            "sha256:0000000000000000000000000000000000000000000000000000000000000000";
        let path = file.path().to_path_buf();

        let result = verify_and_cleanup(&path, wrong_checksum);

        assert!(
            result.is_err(),
            "a mismatched checksum must return an error"
        );
        assert!(
            !path.exists(),
            "a mismatched checksum must delete the downloaded file"
        );
    }
}
