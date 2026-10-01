import { logService } from '../log/logService';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { iframeReadyAck, type IpcPendingMessage } from '../../lib/ipc/iframeLifecycleCommands';
import { toWireMessage } from './extensionDelivery';
import { extensionPendingState } from './extensionPendingState.svelte';

export type PreferenceProvider = (extensionId: string) => Promise<{
  extension: Record<string, unknown>;
  commands: Record<string, Record<string, unknown>>;
}>;

let preferenceProvider: PreferenceProvider | null = null;

export function setWorkerPreferenceProvider(provider: PreferenceProvider): void {
  preferenceProvider = provider;
}

export interface WorkerChannel {
  extensionId: string;
  mountToken: number;
  postMessage(message: unknown): void;
  terminate(): void;
  rawWorker?: Worker;
}

type WorkerIpcHandler = (event: MessageEvent) => Promise<void> | void;

class HeadlessSimulatedWorker implements WorkerChannel {
  private terminated = false;
  constructor(
    public readonly extensionId: string,
    public readonly mountToken: number,
    private readonly onHostMessage: (msg: unknown) => void,
  ) {
    // Schedule simulated boot notification on next microtask
    queueMicrotask(() => {
      if (this.terminated) return;
      this.onHostMessage({
        type: 'asyar:extension:loaded',
        role: 'worker',
        extensionId,
        mountToken,
      });
    });
  }

  postMessage(message: unknown): void {
    if (this.terminated) return;
    // In simulated mode, actions or commands sent to the worker can be acknowledged or logged
    logService.debug(`[workerHost:simulated] worker received: ${JSON.stringify(message)}`);
  }

  terminate(): void {
    this.terminated = true;
  }
}

export class WorkerHost {
  private activeWorkers = new Map<string, WorkerChannel>();
  private sourceMap = new WeakMap<object, string>();
  private ipcHandler: WorkerIpcHandler | null = null;
  private _fallbackEntries = $state<{ extensionId: string; mountToken: number }[]>([]);
  private readyWorkers = new Set<string>();

  get fallbackEntries(): ReadonlyArray<{ extensionId: string; mountToken: number }> {
    return this._fallbackEntries;
  }

  public setIpcHandler(handler: WorkerIpcHandler): void {
    this.ipcHandler = handler;
  }

  public hasWorker(extensionId: string): boolean {
    return this.activeWorkers.has(extensionId);
  }

  public getWorker(extensionId: string): WorkerChannel | undefined {
    return this.activeWorkers.get(extensionId);
  }

  public findExtensionIdForSource(source: unknown): string | undefined {
    if (!source || typeof source !== 'object') return undefined;
    return this.sourceMap.get(source);
  }

  public hasSource(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false;
    return this.sourceMap.has(source);
  }

  public mount(extensionId: string, mountToken: number): void {
    logService.debug(`[workerHost] mount ${extensionId} token=${mountToken}`);

    // Clean up existing worker if already running
    this.unmount(extensionId, 'remount');

    const channel = this.createWorkerChannel(extensionId, mountToken);
    if (!channel) return;
    this.activeWorkers.set(extensionId, channel);
    this.sourceMap.set(channel, extensionId);
    if (channel.rawWorker) {
      this.sourceMap.set(channel.rawWorker, extensionId);
    }
  }

  public unmount(extensionId: string, reason: string): void {
    logService.debug(`[workerHost] unmount ${extensionId} reason=${reason}`);
    const channel = this.activeWorkers.get(extensionId);
    if (channel) {
      try {
        channel.terminate();
      } catch (err) {
        logService.warn(`[workerHost] error terminating worker ${extensionId}: ${err}`);
      }
      this.sourceMap.delete(channel);
      if (channel.rawWorker) {
        this.sourceMap.delete(channel.rawWorker);
      }
      this.activeWorkers.delete(extensionId);
    }
    this.readyWorkers.delete(extensionId);

    const fallbackIdx = this._fallbackEntries.findIndex((e) => e.extensionId === extensionId);
    if (fallbackIdx >= 0) {
      this._fallbackEntries.splice(fallbackIdx, 1);
    }
  }

  public deliver(extensionId: string, message: IpcPendingMessage): void {
    const channel = this.activeWorkers.get(extensionId);
    if (!channel) {
      logService.warn(`[workerHost] cannot deliver to missing worker: ${extensionId}`);
      return;
    }
    const wire = toWireMessage(message);
    if (!wire) return;
    channel.postMessage(wire);
  }

  public post(extensionId: string, message: unknown): void {
    const channel = this.activeWorkers.get(extensionId);
    if (!channel) {
      logService.warn(`[workerHost] cannot post to missing worker: ${extensionId}`);
      return;
    }
    channel.postMessage(message);
  }

  public broadcastPreferences(
    extensionId: string,
    bundle: {
      extension: Record<string, unknown>;
      commands: Record<string, Record<string, unknown>>;
    },
  ): void {
    this.post(extensionId, {
      type: 'asyar:event:preferences:set-all',
      payload: { extension: bundle.extension, commands: bundle.commands },
    });
  }

  public reset(): void {
    for (const [id] of this.activeWorkers) {
      this.unmount(id, 'reset');
    }
    this.activeWorkers.clear();
    this.readyWorkers.clear();
    this._fallbackEntries.splice(0, this._fallbackEntries.length);
  }

  private fallbackToIframe(extensionId: string, mountToken: number, reason?: unknown): void {
    logService.info(
      `[workerHost] Web Worker bootstrap failed for ${extensionId} (${reason ?? 'bootstrap error'}); falling back to iframe`,
    );
    const existing = this.activeWorkers.get(extensionId);
    if (existing) {
      try {
        existing.terminate();
      } catch (err) {
        logService.warn(`[workerHost] error terminating worker ${extensionId}: ${err}`);
      }
      this.sourceMap.delete(existing);
      if (existing.rawWorker) {
        this.sourceMap.delete(existing.rawWorker);
      }
      this.activeWorkers.delete(extensionId);
    }
    this.readyWorkers.delete(extensionId);

    if (!this._fallbackEntries.some((e) => e.extensionId === extensionId)) {
      this._fallbackEntries.push({ extensionId, mountToken });
    }
  }

  private createWorkerChannel(extensionId: string, mountToken: number): WorkerChannel | null {
    const onHostMessage = (data: any) => {
      this.handleIncomingMessage(extensionId, mountToken, channel, data);
    };

    let channel: WorkerChannel;

    // Check if standard Web Worker is supported in the environment
    if (typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      try {
        const isWindows = navigator.userAgent.toLowerCase().includes('windows');
        const workerUrl = isWindows
          ? `http://asyar-extension.localhost/${extensionId}/dist/worker.js`
          : `asyar-extension://${extensionId}/dist/worker.js`;

        const bootstrapCode = `
          self.__ASYAR_ROLE__ = 'worker';
          const extensionId = ${JSON.stringify(extensionId)};
          const mountToken = ${mountToken};

          (async () => {
            try {
              await import(${JSON.stringify(workerUrl)});
            } catch (err) {
              try {
                const resp = await fetch(${JSON.stringify(workerUrl)});
                if (!resp.ok) throw new Error('HTTP ' + resp.status + ' loading ' + ${JSON.stringify(workerUrl)});
                const code = await resp.text();
                const blob = new Blob([code], { type: 'application/javascript' });
                const blobUrl = URL.createObjectURL(blob);
                await import(blobUrl);
                URL.revokeObjectURL(blobUrl);
              } catch (fallbackErr) {
                self.postMessage({
                  type: 'asyar:feedback:uncaught',
                  payload: {
                    kind: 'worker_bootstrap_error',
                    developerDetail: String(fallbackErr && fallbackErr.stack ? fallbackErr.stack : fallbackErr),
                  },
                });
              }
            }
          })();
        `;

        const blob = new Blob([bootstrapCode], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const rawWorker = new Worker(blobUrl, { type: 'module' });
        URL.revokeObjectURL(blobUrl);

        rawWorker.onmessage = (event: MessageEvent) => {
          onHostMessage(event.data);
        };

        rawWorker.onerror = (err) => {
          if (!this.readyWorkers.has(extensionId)) {
            const detail = (err as ErrorEvent)?.message ?? String(err);
            this.fallbackToIframe(extensionId, mountToken, detail);
            return;
          }
          feedbackService.report({
            source: 'extension',
            kind: 'extension_crash',
            severity: 'error',
            retryable: true,
            context: {
              extensionId,
              role: 'worker',
              detail: String((err as ErrorEvent)?.message || err),
            },
            extensionId,
          });
        };

        channel = {
          extensionId,
          mountToken,
          postMessage: (msg) => rawWorker.postMessage(msg),
          terminate: () => rawWorker.terminate(),
          rawWorker,
        };
        return channel;
      } catch (err) {
        logService.warn(
          `[workerHost] failed to instantiate Web Worker for ${extensionId} (${err}); falling back`,
        );
        this.fallbackToIframe(extensionId, mountToken, err);
        return null;
      }
    }

    // Headless simulated worker (test/jsdom or environments without direct Web Worker support)
    channel = new HeadlessSimulatedWorker(extensionId, mountToken, onHostMessage);
    return channel;
  }

  private handleIncomingMessage(
    extensionId: string,
    mountToken: number,
    channel: WorkerChannel,
    data: any,
  ): void {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'asyar:extension:loaded') {
      this.readyWorkers.add(extensionId);
      void this.handleReadiness(extensionId, mountToken, channel);
      return;
    }

    if (data.type === 'asyar:feedback:uncaught') {
      if (data.payload?.kind === 'worker_bootstrap_error') {
        this.fallbackToIframe(extensionId, mountToken, data.payload?.developerDetail);
        return;
      }
      void feedbackService.report({
        source: 'extension',
        kind: data.payload?.kind ?? 'worker_uncaught',
        severity: 'error',
        retryable: false,
        context: { extensionId, role: 'worker' },
        extensionId,
        developerDetail: data.payload?.developerDetail,
      });
      return;
    }

    if (this.ipcHandler) {
      const syntheticSource = (channel.rawWorker ?? channel) as unknown as MessageEventSource;
      const syntheticEvent = {
        data,
        source: syntheticSource,
        origin: `asyar-extension://${extensionId}`,
      } as MessageEvent;
      void this.ipcHandler(syntheticEvent);
    }
  }

  private async handleReadiness(
    extensionId: string,
    mountToken: number,
    channel: WorkerChannel,
  ): Promise<void> {
    const drained = await iframeReadyAck(extensionId, mountToken, 'worker');
    if (drained === null) {
      logService.warn(`[workerHost] ack failed for ${extensionId}`);
      return;
    }
    for (const m of drained) {
      this.deliver(extensionId, m);
    }
    extensionPendingState.markReady(extensionId);

    try {
      if (preferenceProvider) {
        const bundle = await preferenceProvider(extensionId);
        if (bundle) {
          channel.postMessage({
            type: 'asyar:event:preferences:set-all',
            payload: { extension: bundle.extension, commands: bundle.commands },
          });
        }
      }
    } catch (err) {
      logService.debug(
        `[workerHost] could not fetch initial preferences for ${extensionId}: ${err}`,
      );
    }
  }
}

export const workerHost = new WorkerHost();
