import { invoke } from '@tauri-apps/api/core';
import { logService } from '../log/logService';

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
    // 1. Check trust store first (hot path, no UI)
    try {
      const isTrusted = await invoke<boolean>('shell_check_trust', {
        extensionId,
        binaryPath: resolvedPath
      });
      
      if (isTrusted) return true;
    } catch (e) {
      logService.error('[ShellConsentService] Failed to check trust:', e);
    }

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
    try {
      await invoke('shell_grant_trust', { extensionId, binaryPath: resolvedPath });
      resolve(true);
    } catch (e) {
      logService.error('[ShellConsentService] Failed to grant trust:', e);
      resolve(false);
    }
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
