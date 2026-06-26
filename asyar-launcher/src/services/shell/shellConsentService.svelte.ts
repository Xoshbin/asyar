import { shellCheckTrust, shellGrantTrust } from '../../lib/ipc/shellCommands';

interface ConsentRequest {
  extensionId: string;
  program: string;
  resolvedPath: string;
  resolve: (allowed: boolean) => void;
}

class ShellConsentService {
  activeRequest = $state<ConsentRequest | null>(null);
  private pendingRequests = new Map<string, Promise<boolean>>();

  /**
   * Requests user consent to run a binary for a specific extension.
   * If the binary is already trusted, returns true immediately.
   * Otherwise, shows a dialog and waits for user decision.
   * Concurrent requests for the same extension+binary are deduplicated.
   */
  async requestConsent(
    extensionId: string,
    program: string,
    resolvedPath: string
  ): Promise<boolean> {
    // 1. Check trust store first (hot path, no UI). A failed check falls
    // through to the dialog below rather than blocking the request.
    const isTrusted = await shellCheckTrust(extensionId, resolvedPath);
    if (isTrusted) return true;

    // 2. Deduplicate concurrent requests for the same (extension, binary) pair
    const key = `${extensionId}:${resolvedPath}`;
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key)!;
    }

    const promise = new Promise<boolean>((resolve) => {
      this.activeRequest = {
        extensionId,
        program,
        resolvedPath,
        resolve: (allowed: boolean) => {
          this.activeRequest = null;
          this.pendingRequests.delete(key);
          resolve(allowed);
        }
      };
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Grants trust to the binary and resolves the active request.
   */
  async approveCurrent() {
    if (!this.activeRequest) return;
    
    const { extensionId, resolvedPath, resolve } = this.activeRequest;
    const ok = await shellGrantTrust(extensionId, resolvedPath);
    resolve(ok);
  }

  /**
   * Denies trust and resolves the active request.
   */
  async denyCurrent() {
    if (!this.activeRequest) return;
    this.activeRequest.resolve(false);
  }
}

export const shellConsentService = new ShellConsentService();
