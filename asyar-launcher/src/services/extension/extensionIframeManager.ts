import { writable } from 'svelte/store';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import { logService } from "../log/logService";
import { viewManager } from "./viewManager";

export const extensionHasInputFocus = writable<boolean>(false);

export class ExtensionIframeManager {
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
}

export const extensionIframeManager = new ExtensionIframeManager();
