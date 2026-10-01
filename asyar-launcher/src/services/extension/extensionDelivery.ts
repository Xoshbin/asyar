import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import type { IpcPendingMessage } from '../../lib/ipc/iframeLifecycleCommands';

const WIRE: Record<IpcPendingMessage['kind'], string | null> = {
  command: 'asyar:command:execute',
  action: 'asyar:action:execute',
  viewSubmit: 'asyar:view:submit',
  viewSearch: 'asyar:view:search',
  predictiveWarm: null,
};

export function toWireMessage(
  message: IpcPendingMessage,
): { type: string; payload: Record<string, unknown> } | null {
  const type = WIRE[message.kind];
  if (!type) return null;
  return { type, payload: message.payload };
}

export function post(iframe: HTMLIFrameElement, message: IpcPendingMessage): void {
  const wire = toWireMessage(message);
  if (!wire) return;
  const extensionId = iframe.getAttribute('data-extension-id');
  if (!extensionId || !iframe.contentWindow) return;
  iframe.contentWindow.postMessage(wire, getExtensionFrameOrigin(extensionId));
}
