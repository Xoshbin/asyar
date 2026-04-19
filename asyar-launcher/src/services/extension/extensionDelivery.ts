import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import type { IpcPendingMessage } from '../../lib/ipc/iframeLifecycleCommands';

const WIRE: Record<IpcPendingMessage['kind'], string | null> = {
  command: 'asyar:command:execute',
  action: 'asyar:action:execute',
  viewSubmit: 'asyar:view:submit',
  viewSearch: 'asyar:view:search',
  predictiveWarm: null,
};

export function post(iframe: HTMLIFrameElement, message: IpcPendingMessage): void {
  const type = WIRE[message.kind];
  if (!type) return;
  const extensionId = iframe.getAttribute('data-extension-id');
  if (!extensionId || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(
    { type, payload: message.payload },
    getExtensionFrameOrigin(extensionId),
  );
}
