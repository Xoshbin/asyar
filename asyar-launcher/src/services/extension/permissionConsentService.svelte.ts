import * as commands from '../../lib/ipc/commands';
import { getRuntimeDownloadSizes, type RuntimeDownload } from '../../lib/ipc/runtimeCommands';
import { logService } from '../log/logService';

/** Why the consent dialog is being shown; drives its subtitle copy. */
export type ConsentReason = 'install' | 'enable' | 'update' | 'review';

export interface PermissionConsentRequest {
  extensionId: string;
  extensionName: string;
  reason: ConsentReason;
  permissions: string[];
  permissionArgs: Record<string, unknown>;
  /** Declared runtimes not yet installed, with their download size. */
  runtimeDownloads?: RuntimeDownload[];
}

interface QueuedRequest {
  request: PermissionConsentRequest;
  resolve: (accepted: boolean) => void;
}

/**
 * Host-side consent prompt state, following the `feedbackService.activeDialog`
 * resolver pattern. Unlike `confirmAlert` (which cancels a second concurrent
 * caller), requests are FIFO-queued — a consent decision must never silently
 * default to "declined" because another dialog happened to be open.
 *
 * The actual enforcement lives in Rust (`register_extension_permissions`
 * withholds undeclared-consent permission sets); this service only drives the
 * UI and records acceptance.
 */
class PermissionConsentService {
  activeRequest = $state<PermissionConsentRequest | null>(null);

  /**
   * Extensions whose load-time permission registration was withheld because
   * the declared set exceeds recorded consent. Per-webview, populated by the
   * extension loader; the settings panel re-derives via `checkExtensionConsent`.
   */
  needsReview = $state<string[]>([]);

  /**
   * Bumped whenever a consent record is written in this webview. UI that
   * derives consent state via `checkExtensionConsent` (e.g. the settings
   * detail panel's needs-review badge) reads this in its $effect so it
   * re-checks after an acceptance recorded outside its own flow.
   */
  consentVersion = $state(0);

  private queue: QueuedRequest[] = [];
  private activeResolver: ((accepted: boolean) => void) | null = null;

  reset(): void {
    this.activeRequest = null;
    this.needsReview = [];
    this.queue = [];
    this.activeResolver = null;
  }

  /** Show the consent dialog (queued behind any dialog already open). */
  requestConsent(request: PermissionConsentRequest): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.queue.push({ request, resolve });
      this.pump();
    });
  }

  /** Called by the dialog when the user accepts. */
  onAccepted(): void {
    this.settle(true);
  }

  /** Called by the dialog on Cancel, Escape, or backdrop click. */
  onDeclined(): void {
    this.settle(false);
  }

  markNeedsReview(extensionId: string): void {
    if (!this.needsReview.includes(extensionId)) {
      this.needsReview = [...this.needsReview, extensionId];
    }
  }

  private markReviewed(extensionId: string): void {
    if (this.needsReview.includes(extensionId)) {
      this.needsReview = this.needsReview.filter((id) => id !== extensionId);
    }
  }

  /**
   * Ensure the user has consented to `extensionId`'s currently declared
   * permission set, prompting if not. On acceptance the consent record is
   * persisted and the permissions are (re-)registered in the Rust registry,
   * so acceptance takes effect without a restart.
   *
   * Returns true when the caller may proceed (consent already covered,
   * nothing to consent to, or the user accepted). On an IPC failure the
   * caller may also proceed: the Rust load-time backstop still withholds
   * unconsented permissions, so failing open here only affects UX, not
   * enforcement.
   */
  async ensureConsent(
    extensionId: string,
    extensionName: string,
    reason: ConsentReason,
  ): Promise<boolean> {
    const status = await commands.checkExtensionConsent(extensionId);
    if (!status) {
      logService.warn(
        `[PermissionConsent] checkExtensionConsent failed for ${extensionId}; proceeding (Rust backstop still enforces)`,
      );
      return true;
    }

    // Permission consent and pending runtime downloads are independent
    // concerns: mark reviewed as soon as permissions are covered, whether
    // or not the user goes on to decline an unrelated runtime download
    // below — a runtime decline must never leave "needs review" stuck.
    if (!status.needsConsent) {
      this.markReviewed(extensionId);
    }

    const declaredRuntimes = status.declaredRuntimes ?? [];
    const runtimeDownloads =
      declaredRuntimes.length > 0 ? await getRuntimeDownloadSizes(declaredRuntimes) : [];

    if (!status.needsConsent && runtimeDownloads.length === 0) {
      return true;
    }

    const accepted = await this.requestConsent({
      extensionId,
      extensionName,
      reason,
      permissions: status.declaredPermissions,
      permissionArgs: status.declaredArgs,
      runtimeDownloads,
    });
    if (!accepted) {
      return false;
    }

    await commands.setExtensionConsent(
      extensionId,
      status.declaredPermissions,
      status.declaredArgs,
    );
    await commands.registerExtensionPermissions(
      extensionId,
      status.declaredPermissions,
      status.declaredArgs,
    );
    this.markReviewed(extensionId);
    this.consentVersion++;
    return true;
  }

  /**
   * Withdraw a previously-granted consent record (Settings → Extensions
   * "Revoke" action). Bumps `consentVersion` on success so any panel
   * deriving `needsConsent` via `checkExtensionConsent` (e.g. the settings
   * detail panel's badge) re-checks and reflects the withdrawal
   * immediately — enforcement itself is already live the moment Rust's
   * `revoke_extension_consent` returns, since it unregisters synchronously.
   */
  async revoke(extensionId: string): Promise<boolean> {
    const ok = await commands.revokeExtensionConsent(extensionId);
    if (ok) {
      this.consentVersion++;
    }
    return ok;
  }

  private pump(): void {
    if (this.activeRequest !== null) return;
    const next = this.queue.shift();
    if (!next) return;
    this.activeResolver = next.resolve;
    this.activeRequest = next.request;
  }

  private settle(accepted: boolean): void {
    const resolver = this.activeResolver;
    this.activeResolver = null;
    this.activeRequest = null;
    resolver?.(accepted);
    this.pump();
  }
}

export const permissionConsentService = new PermissionConsentService();
