import type { WireCommand } from './namespaces';
import { emitIpcLog } from './devInspectorBridge';

export interface IPCMessage<T = any> {
  type: string;
  payload?: T;
  messageId: string;
  extensionId?: string;
}

export interface IPCResponse<T = any> {
  type: string;
  messageId: string;
  result?: T;
  error?: string;
}

export type HostDispatcher = (
  command: WireCommand,
  payload: Record<string, unknown> | unknown[] | undefined,
  extensionId: string | undefined,
) => unknown | Promise<unknown>;

export class MessageBroker {
  private pendingRequests: Map<string, {
    resolve: (val: unknown) => void;
    reject: (err: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    /** Debug-only: captured at send time so the response log can report elapsed. */
    startedAt: number;
    command: WireCommand;
  }> = new Map();
  private eventListeners: Map<string, Set<(payload: unknown) => void>> = new Map();
  private isBrowser: boolean;
  private extensionId?: string;
  private hostDispatcher: HostDispatcher | null = null;

  constructor() {
    this.isBrowser = typeof window !== 'undefined' && typeof window.parent !== 'undefined';
    this.setupListeners();
  }

  public setExtensionId(id: string): void {
    this.extensionId = id;
  }

  /**
   * Dispatch host-realm invokes synchronously via `dispatcher` instead of
   * postMessage. Iframes are unaffected.
   */
  public setHostDispatcher(dispatcher: HostDispatcher | null): void {
    this.hostDispatcher = dispatcher;
  }

  private isHostRealm(): boolean {
    return this.isBrowser && typeof window !== 'undefined' && window.parent === window;
  }

  private setupListeners() {
    if (this.isBrowser) {
      window.addEventListener('message', this.handleMessage.bind(this));
    } else if (typeof process !== 'undefined') {
      if (process.send) {
        process.on('message', this.handleMessage.bind(this));
      } else if (process.stdin) {
        process.stdin.on('data', (data) => {
          try {
            const messages = data.toString().split('\n').filter(Boolean);
            for (const msgStr of messages) {
              const msg = JSON.parse(msgStr);
              this.handleMessage(msg);
            }
          } catch (e) {
            console.error('Failed to parse IPC message from stdin', e);
          }
        });
      }
    }
  }

  private handleMessage(event: MessageEvent | Record<string, unknown>) {
    const data = this.isBrowser ? (event as MessageEvent).data : event;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'asyar:response') {
      const response = data as IPCResponse;
      const pending = this.pendingRequests.get(response.messageId);
      if (pending) {
        clearTimeout(pending.timer);
        emitIpcLog({
          phase: 'response',
          command: pending.command,
          result: response.error ? undefined : response.result,
          error: response.error,
          messageId: response.messageId,
          elapsedMs: Date.now() - pending.startedAt,
          timestamp: Date.now(),
          extensionId: this.extensionId,
        });
        if (response.error) {
          pending.reject(new Error(response.error));
        } else {
          pending.resolve(response.result);
        }
        this.pendingRequests.delete(response.messageId);
      }
    } else if (data.type?.startsWith('asyar:event:')) {
      const listeners = this.eventListeners.get(data.type);
      if (listeners) {
        listeners.forEach(listener => listener(data.payload));
      }
    } else if (data.type?.startsWith('asyar:invoke:')) {
      // Main app calling an extension function
      const listeners = this.eventListeners.get(data.type);
      if (listeners) {
         listeners.forEach(listener => listener(data));
      }
    } else if (data.messageId && data.type?.startsWith('asyar:api:')) {
      // Ignore messages intended for main app if they loop back somehow
      return;
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  public invoke<T>(command: WireCommand, payload?: Record<string, unknown> | unknown[], extensionId?: string, timeoutMs: number = 10000): Promise<T> {
    if (this.hostDispatcher && this.isHostRealm()) {
      try {
        return Promise.resolve(this.hostDispatcher(command, payload, extensionId)) as Promise<T>;
      } catch (err) {
        return Promise.reject(err) as Promise<T>;
      }
    }

    return new Promise((resolve, reject) => {
      const messageId = this.generateId();
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        emitIpcLog({
          phase: 'response',
          command,
          error: `IPC timeout after ${timeoutMs}ms`,
          messageId,
          elapsedMs: timeoutMs,
          timestamp: Date.now(),
          extensionId: extensionId ?? this.extensionId,
        });
        reject(new Error(`IPC timeout after ${timeoutMs}ms for command: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, {
        resolve: resolve as (val: unknown) => void,
        reject,
        timer,
        startedAt,
        command,
      });

      const message: IPCMessage = {
        type: `asyar:api:${command}`,
        payload: payload || {},
        messageId,
        ...(extensionId ? { extensionId } : {})
      };

      emitIpcLog({
        phase: 'invoke',
        command,
        payload,
        messageId,
        timestamp: startedAt,
        extensionId: extensionId ?? this.extensionId,
      });

      this.send(message);
    });
  }

  public send(message: IPCMessage | IPCResponse): void {
    if (this.isBrowser) {
      window.parent.postMessage(message, '*');
    } else if (typeof process !== 'undefined') {
      if (process.send) {
        process.send(message);
      } else if (process.stdout) {
        process.stdout.write(JSON.stringify(message) + '\n');
      }
    }
  }

  public on(event: string, listener: (payload: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (payload: unknown) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }
}

export const messageBroker = new MessageBroker();
