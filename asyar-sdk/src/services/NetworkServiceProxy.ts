import type {
  INetworkService,
  RequestOptions,
  NetworkResponse,
  WebSocketOptions,
  IWebSocketHandle,
} from '../types/NetworkType';
import { BaseServiceProxy } from './BaseServiceProxy';

export class NetworkServiceProxy extends BaseServiceProxy implements INetworkService {
  async fetch(url: string, options?: RequestOptions): Promise<NetworkResponse> {
    const invokePromise = this.broker.invoke('network:fetch', { url, options: options ?? {} });
    const ipcTimeout = (options?.timeout ?? 25000) + 15000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`IPC Request timed out after ${ipcTimeout}ms`)),
        ipcTimeout,
      ),
    );
    return Promise.race([invokePromise, timeoutPromise]) as Promise<NetworkResponse>;
  }

  async connectWebSocket(url: string, options?: WebSocketOptions): Promise<IWebSocketHandle> {
    const socketId = `ws_${Math.random().toString(36).slice(2)}_${Date.now()}`;

    const openListeners = new Set<() => void>();
    const messageListeners = new Set<(data: string) => void>();
    const errorListeners = new Set<(err: string) => void>();
    const closeListeners = new Set<(info: { code?: number; reason?: string }) => void>();

    // Buffer early events that arrive before the caller registers callbacks.
    // The Rust read_task emits "open" from a tokio::spawn which can fire
    // before the IPC round-trip resolves, so onOpen() would miss it.
    let didOpen = false;
    let closeInfo: { code?: number; reason?: string } | null = null;

    const listener = (payload: unknown): void => {
      const p = payload as {
        socket_id?: string;
        event_type?: string;
        data?: string;
        code?: number;
      };
      if (p?.socket_id !== socketId) return;

      switch (p.event_type) {
        case 'open':
          didOpen = true;
          openListeners.forEach((cb) => cb());
          break;
        case 'message':
          if (p.data !== undefined) {
            messageListeners.forEach((cb) => cb(p.data!));
          }
          break;
        case 'error':
          if (p.data !== undefined) {
            errorListeners.forEach((cb) => cb(p.data!));
          }
          break;
        case 'close':
          closeInfo = { code: p.code, reason: p.data };
          closeListeners.forEach((cb) => cb(closeInfo!));
          this.broker.off('asyar:event:network:wsMessage:push', listener);
          break;
      }
    };

    this.broker.on('asyar:event:network:wsMessage:push', listener);

    await this.broker.invoke('network:wsConnect', {
      socketId,
      url,
      headers: options?.headers,
    });

    const broker = this.broker;

    const handle: IWebSocketHandle = {
      socketId,
      async send(data: string): Promise<void> {
        await broker.invoke('network:wsSend', { socketId, message: data });
      },
      async close(code?: number, reason?: string): Promise<void> {
        await broker.invoke('network:wsClose', { socketId, code, reason });
      },
      onOpen(callback: () => void): () => void {
        openListeners.add(callback);
        // Replay buffered open if it already fired
        if (didOpen) callback();
        return () => openListeners.delete(callback);
      },
      onMessage(callback: (data: string) => void): () => void {
        messageListeners.add(callback);
        return () => messageListeners.delete(callback);
      },
      onError(callback: (err: string) => void): () => void {
        errorListeners.add(callback);
        return () => errorListeners.delete(callback);
      },
      onClose(callback: (info: { code?: number; reason?: string }) => void): () => void {
        closeListeners.add(callback);
        // Replay buffered close if it already fired
        if (closeInfo) callback(closeInfo);
        return () => closeListeners.delete(callback);
      },
    };

    return handle;
  }
}
