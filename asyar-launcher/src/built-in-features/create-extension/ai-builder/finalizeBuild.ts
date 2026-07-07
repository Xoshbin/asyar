import { registerDevExtension } from '../../../lib/ipc/commands';
import { scanForSecret, type SecretScanResult } from './secretGuard';
import { buildJobStore } from './buildJobStore.svelte';
import { permissionConsentService } from '../../../services/extension/permissionConsentService.svelte';

export async function finalizeBuild(path: string, extensionId: string): Promise<SecretScanResult> {
  const secret = buildJobStore.buildSecret;
  if (secret && secret.trim().length > 0) {
    const result = await scanForSecret(path, secret);
    if (result.leaked) return result;
  }
  const registered = await registerDevExtension(extensionId, path);
  if (!registered) {
    throw new Error(`Failed to register dev extension "${extensionId}"`);
  }
  const { ExtensionManagerProxy } = await import('asyar-sdk/contracts');
  await new ExtensionManagerProxy().reloadExtensions();
  // Dev extensions get the same consent treatment as store installs; no-op
  // when the built manifest declares no permissions.
  await permissionConsentService.ensureConsent(extensionId, extensionId, 'install');
  return { leaked: false };
}
