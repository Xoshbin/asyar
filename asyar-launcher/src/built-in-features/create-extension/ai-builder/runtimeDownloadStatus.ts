import type { RuntimeDownloadProgress } from '../../../lib/ipc/runtimeCommands';

// Local copy, not imported from actionService.svelte.ts: that module
// instantiates a heavy singleton on load, which drags in Tauri/window
// dependencies this pure formatter shouldn't need — RuntimeBatchConsentDialog
// in this same directory keeps its own copy for the same reason.
function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'an unknown size';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Human-readable label for the live runtime-download status shown while
 * `orchestrator.ts` downloads bun/claude sequentially before a build starts.
 * `fallback` covers the pre-progress-event window (request sent, no event
 * received yet) so the caller never has to show a blank string. */
export function formatRuntimeDownloadStatus(
  progress: RuntimeDownloadProgress | null,
  fallback: string,
): string {
  if (!progress) return fallback;
  switch (progress.status) {
    case 'resolving':
      return 'Checking for updates…';
    case 'downloading': {
      if (progress.totalBytes <= 0) return 'Downloading…';
      return `Downloading… ${formatBytes(progress.bytesDownloaded)} / ${formatBytes(progress.totalBytes)}`;
    }
    case 'verifying':
      return 'Verifying download…';
    case 'extracting':
      return 'Installing…';
    case 'signing':
      return 'Finishing setup…';
    case 'ready':
      return fallback;
    case 'failed':
      return 'Download failed';
  }
}
