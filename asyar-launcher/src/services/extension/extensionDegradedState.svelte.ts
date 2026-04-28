import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

class ExtensionDegradedState {
  private toastedThisSession = new Set<string>();

  noticeForUser(extensionId: string, displayName: string, strikes: number): void {
    if (this.toastedThisSession.has(extensionId)) return;
    this.toastedThisSession.add(extensionId);
    void diagnosticsService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: `${displayName} isn't responding — ${strikes} strikes. Try again in an hour or reinstall.` },
    });
  }

  recovered(extensionId: string): void {
    this.toastedThisSession.delete(extensionId);
  }

  reset(): void {
    this.toastedThisSession.clear();
  }
}

export const extensionDegradedState = new ExtensionDegradedState();
