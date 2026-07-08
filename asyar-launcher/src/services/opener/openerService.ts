import { openerOpenUrl } from '../../lib/ipc/commands';

/**
 * The `opener` namespace is in ALWAYS_INJECTS_CALLER_ID, so `open`
 * receives the router-verified caller identity first — `null` for
 * privileged host-context calls. The Rust command allows the web-default
 * schemes for everyone and additionally the caller's declared
 * `permissionArgs["shell:open-url"]` schemes; denials reject through to
 * the caller.
 */
export class OpenerService {
  async open(callerExtensionId: string | null, url: string): Promise<void> {
    if (!url) return;
    await openerOpenUrl(callerExtensionId, url);
  }
}

export const openerService = new OpenerService();
