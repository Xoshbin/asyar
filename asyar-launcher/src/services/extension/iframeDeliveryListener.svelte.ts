import { listen } from '@tauri-apps/api/event';
import { post } from './extensionDelivery';
import type { IpcPendingMessage } from '../../lib/ipc/iframeLifecycleCommands';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

interface DeliverPayload {
  extensionId: string;
  role: 'view' | 'worker';
  messages: IpcPendingMessage[];
}

export class IframeDeliveryListener {
  private unlisten: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<DeliverPayload>('asyar:iframe:deliver', (e) => {
      const { extensionId, role, messages } = e.payload;
      const iframe = document.querySelector<HTMLIFrameElement>(
        `iframe[data-extension-id="${extensionId}"][data-role="${role}"]`,
      );
      if (!iframe) {
        void diagnosticsService.report({
          source: 'frontend',
          kind: 'extension-runtime/scheduler-deliver-no-iframe',
          severity: 'warning',
          retryable: false,
          developerDetail: `no iframe for ${extensionId} role=${role}; dropping ${messages.length} message(s)`,
          context: { extensionId, role, messageCount: String(messages.length) },
        });
        return;
      }
      for (const m of messages) post(iframe, m);
    });
  }

  reset(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

export const iframeDeliveryListener = new IframeDeliveryListener();
