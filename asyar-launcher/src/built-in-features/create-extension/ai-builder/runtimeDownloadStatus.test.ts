import { describe, it, expect } from 'vitest';
import { formatRuntimeDownloadStatus } from './runtimeDownloadStatus';

describe('formatRuntimeDownloadStatus', () => {
  it('returns the fallback when there is no progress yet', () => {
    expect(formatRuntimeDownloadStatus(null, 'Starting…')).toBe('Starting…');
  });

  it('shows a checking message while resolving', () => {
    expect(formatRuntimeDownloadStatus({ status: 'resolving' }, 'Starting…')).toBe(
      'Checking for updates…',
    );
  });

  it('shows formatted downloaded/total bytes while downloading', () => {
    const result = formatRuntimeDownloadStatus(
      { status: 'downloading', bytesDownloaded: 12_300_000, totalBytes: 60_200_000 },
      'Starting…',
    );
    // 12_300_000 / 1024² ≈ 11.7 MiB, 60_200_000 / 1024² ≈ 57.4 MiB — this
    // formatter matches RuntimeBatchConsentDialog's binary (1024-based) MB.
    expect(result).toBe('Downloading… 11.7 MB / 57.4 MB');
  });

  it('falls back to a generic downloading message when total size is unknown', () => {
    const result = formatRuntimeDownloadStatus(
      { status: 'downloading', bytesDownloaded: 12_300_000, totalBytes: 0 },
      'Starting…',
    );
    expect(result).toBe('Downloading…');
  });

  it('shows a verifying message', () => {
    expect(formatRuntimeDownloadStatus({ status: 'verifying' }, 'Starting…')).toBe(
      'Verifying download…',
    );
  });

  it('shows an installing message while extracting', () => {
    expect(formatRuntimeDownloadStatus({ status: 'extracting' }, 'Starting…')).toBe('Installing…');
  });

  it('shows a finishing-setup message while signing', () => {
    expect(formatRuntimeDownloadStatus({ status: 'signing' }, 'Starting…')).toBe(
      'Finishing setup…',
    );
  });

  it('falls back to the caller-provided label when ready (transient, about to move on)', () => {
    expect(formatRuntimeDownloadStatus({ status: 'ready' }, 'Starting…')).toBe('Starting…');
  });

  it('shows a failure message', () => {
    expect(
      formatRuntimeDownloadStatus({ status: 'failed', error: 'network error' }, 'Starting…'),
    ).toBe('Download failed');
  });
});
