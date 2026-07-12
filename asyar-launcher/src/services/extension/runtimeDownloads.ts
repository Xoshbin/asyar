import { checkExtensionConsent } from '../../lib/ipc/commands';
import { downloadRuntime, getRuntimeDownloadSizes } from '../../lib/ipc/runtimeCommands';
import { extensionStateManager } from './extensionStateManager.svelte';

/**
 * Downloads every declared-but-not-yet-installed runtime for `extensionId`,
 * tagged with `ext:<extensionId>` as the runtime consumer. A failed
 * download must not abort the extension install — it marks the extension
 * `needsRuntime` instead (retryable from the detail panel), never leaving
 * a broken or half-installed extension; a fully successful pass clears it.
 * Shared by the store install flow and the Settings detail panel's retry
 * action — self-sufficient (reads the extension's declared runtimes
 * itself) so callers don't have to fetch and thread that list through.
 */
export async function downloadDeclaredRuntimes(extensionId: string): Promise<void> {
  const status = await checkExtensionConsent(extensionId);
  const declaredRuntimes = status?.declaredRuntimes ?? [];
  if (declaredRuntimes.length === 0) return;

  const missing = await getRuntimeDownloadSizes(declaredRuntimes);
  let anyFailed = false;
  for (const { name } of missing) {
    const ok = await downloadRuntime(name, `ext:${extensionId}`);
    if (!ok) {
      anyFailed = true;
    }
  }

  if (anyFailed) {
    extensionStateManager.markNeedsRuntime(extensionId);
  } else {
    extensionStateManager.clearNeedsRuntime(extensionId);
  }
}
