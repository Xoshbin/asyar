import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { logService } from "../log/logService";
import type { viewManager } from './viewManager.svelte';

/**
 * Prefer the given role's iframe, fall back to the other role, then to an
 * unscoped selector. Without this, an unfiltered `iframe[data-extension-id]`
 * selector hits whichever iframe comes first in DOM order (typically the
 * view) and a message meant for a worker-only handler vanishes silently.
 */
function pickExtensionIframe(extensionId: string, prefer: 'view' | 'worker'): HTMLIFrameElement | null {
  const fallback = prefer === 'view' ? 'worker' : 'view';
  return (
    (document.querySelector(
      `iframe[data-extension-id="${extensionId}"][data-role="${prefer}"]`,
    ) as HTMLIFrameElement | null) ??
    (document.querySelector(
      `iframe[data-extension-id="${extensionId}"][data-role="${fallback}"]`,
    ) as HTMLIFrameElement | null) ??
    (document.querySelector(
      `iframe[data-extension-id="${extensionId}"]`,
    ) as HTMLIFrameElement | null)
  );
}

// Track pending search requests
const pendingSearchRequests = new Map<
  string,
  {
    resolve: (results: any[]) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();

// Generate unique IDs
let searchMessageCounter = 0;
function generateSearchMessageId(): string {
  return `search_${Date.now()}_${++searchMessageCounter}`;
}

export class ExtensionIframeManager {
  hasInputFocus = $state(false);
  private viewManagerInstance: typeof viewManager | null = null;

  public init(viewManagerInstance: typeof viewManager) {
    this.viewManagerInstance = viewManagerInstance;
  }

  forwardKeyToActiveView(keyEvent: {
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
  }): void {
    if (!this.viewManagerInstance) return;
    const currentView = this.viewManagerInstance.getActiveView();
    if (!currentView) return;
    const extensionId = currentView.split('/')[0];
    const iframe = pickExtensionIframe(extensionId, 'view');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:view:keydown', payload: keyEvent },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  /**
   * Post asyar:action:execute to the iframe that actually owns the handler.
   *
   * When `role` is provided (recorded by actionService when the SDK round-
   * trips registerActionHandler), target that role's iframe directly. Fall
   * back to view, then worker, then an unscoped selector.
   */
  sendActionExecuteToExtension(extensionId: string, actionId: string, role?: 'view' | 'worker'): void {
    const iframe = pickExtensionIframe(extensionId, role ?? 'view');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:action:execute', payload: { actionId } },
        getExtensionFrameOrigin(extensionId)
      );
    } else {
      logService.warn(`[ExtensionIframeManager] Could not find iframe for extension ${extensionId} to execute action ${actionId}`);
    }
  }

  /**
   * Send a fresh preferences snapshot to a Tier 2 extension iframe. Called
   * after the user edits preferences so the in-flight iframe picks up the
   * new values without a full reload. For Tier 1 features, the extension
   * host reloads extensions instead (see ExtensionManager).
   *
   * Preferences use direct postMessage to the currently-mounted iframe, not
   * the dispatcher. Dormant extensions pick up the new bundle via the SDK-
   * side stash-and-drain (`__pending__` sentinel in ExtensionBridge) at next
   * mount. Revisit if measured miss-rate exceeds threshold.
   *
   * `bundle` must be plain (non-Proxy) data — postMessage calls
   * structuredClone internally.
   */
  sendPreferencesToExtension(
    extensionId: string,
    bundle: { extension: Record<string, unknown>; commands: Record<string, Record<string, unknown>> }
  ): void {
    const iframe = pickExtensionIframe(extensionId, 'view');
    if (iframe?.contentWindow) {
      // Use the `asyar:event:*` namespace so MessageBroker inside the
      // iframe routes this to registered listeners (see ExtensionBridge).
      iframe.contentWindow.postMessage(
        {
          type: 'asyar:event:preferences:set-all',
          payload: {
            extension: bundle.extension,
            commands: bundle.commands,
          },
        },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  sendViewSearchToExtension(extensionId: string, query: string): void {
    const iframe = pickExtensionIframe(extensionId, 'view');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:view:search', payload: { query } },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  /**
   * Push a searchbar accessory filter-change event to the active view
   * iframe. Used by `searchBarAccessoryService.broadcast` when the user
   * picks a new option, when a programmatic `set({ value })` lands, and
   * when the launcher seeds the value on view mount.
   *
   * If the view iframe isn't mounted (e.g., the user has navigated away
   * before the launcher fired), this is a no-op — the seed value will
   * be re-pushed on the next mount via `searchBarAccessoryService.declare`.
   */
  sendFilterChangeToView(
    extensionId: string,
    payload: { commandId: string; value: string },
  ): void {
    const iframe = pickExtensionIframe(extensionId, 'view');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:event:searchBar:filterChange', payload },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  handleExtensionSubmit(extensionId: string, query: string): void {
    const iframe = pickExtensionIframe(extensionId, 'view');
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:view:submit', payload: { query } },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  /**
   * Send a search request to a Tier 2 extension's iframe.
   * Returns a Promise that resolves with the extension's search results.
   */
  public sendSearchRequestToExtension(
    extensionId: string,
    query: string
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const iframe = pickExtensionIframe(extensionId, 'view');

      if (!iframe?.contentWindow) {
        resolve([]); // No iframe loaded — return empty, don't error
        return;
      }

      const messageId = generateSearchMessageId();

      const SEARCH_REQUEST_TIMEOUT_MS = 5000;
      const timer = setTimeout(() => {
        if (pendingSearchRequests.has(messageId)) {
          pendingSearchRequests.get(messageId)?.resolve([]);
          pendingSearchRequests.delete(messageId);
        }
      }, SEARCH_REQUEST_TIMEOUT_MS);

      pendingSearchRequests.set(messageId, { resolve, reject, timer });

      iframe.contentWindow.postMessage(
        {
          type: 'asyar:search:request',
          messageId,
          payload: { query }
        },
        getExtensionFrameOrigin(extensionId)
      );
    });
  }

  /**
   * Handle search responses from iframes.
   * Call this from the global message listener.
   */
  public handleSearchResponse(event: MessageEvent): void {
    const data = event.data;
    if (!data || data.type !== 'asyar:search:response') return;

    const pending = pendingSearchRequests.get(data.messageId);
    if (pending) {
      clearTimeout(pending.timer);
      if (data.error) {
        pending.resolve([]); // Resolve with empty on error, don't reject
      } else {
        pending.resolve(data.result ?? []);
      }
      pendingSearchRequests.delete(data.messageId);
    }
  }
}

export const extensionIframeManager = new ExtensionIframeManager();
