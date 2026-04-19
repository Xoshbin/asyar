import { feedbackService } from '../feedback/feedbackService.svelte';

class ExtensionDegradedState {
  private toastedThisSession = new Set<string>();

  noticeForUser(extensionId: string, displayName: string, strikes: number): void {
    if (this.toastedThisSession.has(extensionId)) return;
    this.toastedThisSession.add(extensionId);
    void feedbackService.showToast({
      title: `${displayName} isn't responding`,
      message: `${strikes} strikes. Try again in an hour or reinstall.`,
      style: 'failure',
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
