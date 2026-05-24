import type { ExtensionSyncProvider } from '../types/SyncType';

/**
 * Registers a sync provider for the given extension by sending a
 * registration postMessage to the host and setting up message listeners
 * for export, import, and preview IPC calls.
 *
 * The provider is captured by closure in the listeners — no external
 * field storage is needed.
 */
export function registerSyncProvider(extensionId: string, provider: ExtensionSyncProvider): void {
  // Send registration to host via postMessage
  if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'asyar:sync:register',
      extensionId,
      payload: {
        displayName: provider.displayName,
        sensitiveFields: provider.sensitiveFields || [],
        defaultEnabled: provider.defaultEnabled ?? true,
      },
    }, '*');
  }

  // Listen for sync IPC calls from host
  if (typeof window !== 'undefined') {
    window.addEventListener('message', async (event: MessageEvent) => {
      if (event.data?.type === 'asyar:sync:export' && event.data?.extensionId === extensionId) {
        try {
          const data = await provider.export();
          window.parent.postMessage({
            type: 'asyar:sync:export:response',
            extensionId,
            messageId: event.data.messageId,
            payload: data,
            success: true,
          }, '*');
        } catch (err) {
          window.parent.postMessage({
            type: 'asyar:sync:export:response',
            extensionId,
            messageId: event.data.messageId,
            success: false,
            error: String(err),
          }, '*');
        }
      }

      if (event.data?.type === 'asyar:sync:import' && event.data?.extensionId === extensionId) {
        try {
          await provider.import(event.data.payload.data, event.data.payload.strategy);
          window.parent.postMessage({
            type: 'asyar:sync:import:response',
            extensionId,
            messageId: event.data.messageId,
            success: true,
          }, '*');
        } catch (err) {
          window.parent.postMessage({
            type: 'asyar:sync:import:response',
            extensionId,
            messageId: event.data.messageId,
            success: false,
            error: String(err),
          }, '*');
        }
      }

      if (event.data?.type === 'asyar:sync:preview' && event.data?.extensionId === extensionId) {
        try {
          const result = await provider.preview(event.data.payload.data);
          window.parent.postMessage({
            type: 'asyar:sync:preview:response',
            extensionId,
            messageId: event.data.messageId,
            payload: result,
            success: true,
          }, '*');
        } catch (err) {
          window.parent.postMessage({
            type: 'asyar:sync:preview:response',
            extensionId,
            messageId: event.data.messageId,
            success: false,
            error: String(err),
          }, '*');
        }
      }
    });
  }
}
