import { shellCheckTrust, shellGrantTrust } from '../../lib/ipc/shellCommands';
import { showWindow, setFocusLock } from '../../lib/ipc/commands';

interface ConsentRequest {
  extensionId: string;
  program: string;
  resolvedPath: string;
  resolve: (allowed: boolean) => void;
}

class ShellConsentService {
  activeRequest = $state<ConsentRequest | null>(null);
  private queue: ConsentRequest[] = [];
  private pendingRequests = new Map<string, Promise<boolean>>();

  /**
   * Requests user consent to run a binary for a specific extension.
   * If the binary is already trusted, returns true immediately.
   * Otherwise, shows a dialog and waits for user decision.
   * Concurrent requests for the same extension+binary are deduplicated;
   * requests for different pairs are FIFO-queued behind the open dialog.
   */
  async requestConsent(
    extensionId: string,
    program: string,
    resolvedPath: string,
  ): Promise<boolean> {
    // 1. Check trust store first (hot path, no UI). A failed check falls
    // through to the dialog below rather than blocking the request.
    const isTrusted = await shellCheckTrust(extensionId, resolvedPath);
    if (isTrusted) return true;

    // 2. Deduplicate concurrent requests for the same (extension, binary) pair
    const key = `${extensionId}:${resolvedPath}`;
    const pending = this.pendingRequests.get(key);
    if (pending) return pending;

    const promise = new Promise<boolean>((resolve) => {
      this.queue.push({
        extensionId,
        program,
        resolvedPath,
        resolve: (allowed: boolean) => {
          this.pendingRequests.delete(key);
          resolve(allowed);
        },
      });
      this.pump();
    });

    this.pendingRequests.set(key, promise);
    return promise;
  }

  /**
   * Grants trust to the binary and resolves the active request.
   */
  async approveCurrent() {
    const request = this.activeRequest;
    if (!request) return;

    const ok = await shellGrantTrust(request.extensionId, request.resolvedPath);
    this.settle(request, ok);
  }

  /**
   * Denies trust and resolves the active request.
   */
  async denyCurrent() {
    const request = this.activeRequest;
    if (!request) return;
    this.settle(request, false);
  }

  private pump(): void {
    if (this.activeRequest !== null) return;
    this.activeRequest = this.queue.shift() ?? null;
    if (this.activeRequest !== null) {
      // A trust dialog is opening. A background command (e.g. a worker shell
      // spawn) hides the launcher just before this async request lands, so
      // re-show it and hold it open — otherwise the dialog is stranded in a
      // hidden window, or auto-hides on blur while the user reads it.
      void showWindow();
      void setFocusLock(true);
    }
  }

  private settle(request: ConsentRequest, allowed: boolean): void {
    this.activeRequest = null;
    request.resolve(allowed);
    this.pump();
    // Release the focus lock once the queue is fully drained so the launcher
    // can auto-hide normally again.
    if (this.activeRequest === null) {
      void setFocusLock(false);
    }
  }
}

export const shellConsentService = new ShellConsentService();
