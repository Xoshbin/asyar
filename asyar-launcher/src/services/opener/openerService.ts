import { openerOpenUrl, openerOpenPath, openerReveal } from '../../lib/ipc/commands';

export interface OpenPathOptions {
  with?: string;
}

/**
 * The `opener` namespace is in ALWAYS_INJECTS_CALLER_ID, so methods
 * receive the router-verified caller identity first — `null` for
 * privileged host-context calls. The Rust command verifies permissions
 * and parameters, rejecting denials through to the caller.
 */
export class OpenerService {
  async open(callerExtensionId: string | null, url: string): Promise<void> {
    if (!url) return;
    await openerOpenUrl(callerExtensionId, url);
  }

  async openPath(
    callerExtensionId: string | null,
    path: string,
    options?: OpenPathOptions,
  ): Promise<void> {
    if (!path) return;
    await openerOpenPath(callerExtensionId, path, options?.with);
  }

  async reveal(callerExtensionId: string | null, path: string): Promise<void> {
    if (!path) return;
    await openerReveal(callerExtensionId, path);
  }
}

export const openerService = new OpenerService();
