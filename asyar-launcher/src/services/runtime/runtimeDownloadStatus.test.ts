import { describe, it, expect } from 'vitest';
import {
  formatRuntimeDownloadStatus,
  describeMissingRuntimesForConfirm,
} from './runtimeDownloadStatus';

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
    // formatter matches the confirm-dialog's binary (1024-based) MB.
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

describe('describeMissingRuntimesForConfirm', () => {
  it('describes a single missing runtime with a singular title', () => {
    const result = describeMissingRuntimesForConfirm([{ name: 'uv', sizeBytes: 45_000_000 }]);
    expect(result.title).toBe('Download required runtime?');
    expect(result.message).toContain('uv (42.9 MB)');
    expect(result.message).toContain('totaling 42.9 MB');
  });

  it('describes multiple missing runtimes with a plural title and combined total', () => {
    const result = describeMissingRuntimesForConfirm([
      { name: 'bun', sizeBytes: 60_000_000 },
      { name: 'claude', sizeBytes: 240_000_000 },
    ]);
    expect(result.title).toBe('Download required runtimes?');
    expect(result.message).toContain('bun (57.2 MB)');
    expect(result.message).toContain('claude (228.9 MB)');
    expect(result.message).toContain('totaling 286.1 MB');
  });
});
