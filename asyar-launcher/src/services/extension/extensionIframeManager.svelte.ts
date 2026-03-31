import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { logService } from "../log/logService";
import type { viewManager } from './viewManager.svelte';

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
    const iframe = document.querySelector(`iframe[data-extension-id="${extensionId}"]`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:view:keydown', payload: keyEvent },
        getExtensionFrameOrigin(extensionId)
      );
    }
  }

  sendActionExecuteToExtension(extensionId: string, actionId: string): void {
    const iframe = document.querySelector(`iframe[data-extension-id="${extensionId}"]`) as HTMLIFrameElement | null;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(
        { type: 'asyar:action:execute', payload: { actionId } },
        getExtensionFrameOrigin(extensionId)
      );
    } else {
      logService.warn(`[ExtensionIframeManager] Could not find iframe for extension ${extensionId} to execute action ${actionId}`);
    }
  }

  // Caller must pass plain (non-Proxy) data — postMessage calls structuredClone internally.
  broadcastSettingsToIframes(settings: any): void {
    const iframes = document.querySelectorAll('iframe[data-extension-id]');
    iframes.forEach((iframe) => {
      const extId = (iframe as HTMLIFrameElement).dataset.extensionId;
      if (extId) {
        (iframe as HTMLIFrameElement).contentWindow?.postMessage({
          type: 'asyar:event:settingsChanged',
          section: 'calculator',
          payload: settings.calculator
        }, getExtensionFrameOrigin(extId));
      }
    });
  }

  handleExtensionSubmit(extensionId: string, query: string): void {
    const iframe = document.querySelector(`iframe[data-extension-id="${extensionId}"]`) as HTMLIFrameElement | null;
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
      const iframe = document.querySelector(
        `iframe[data-extension-id="${extensionId}"]`
      ) as HTMLIFrameElement | null;

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
