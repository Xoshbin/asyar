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

export class MessageBroker {
  private static instance: MessageBroker;
  private pendingRequests: Map<string, {
    resolve: (val: any) => void;
    reject: (err: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = new Map();
  private eventListeners: Map<string, Set<(payload: any) => void>> = new Map();
  private isBrowser: boolean;
  private extensionId?: string;

  private constructor() {
    this.isBrowser = typeof window !== 'undefined' && typeof window.parent !== 'undefined';
    this.setupListeners();
  }

  public setExtensionId(id: string): void {
    this.extensionId = id;
  }

  public static getInstance(): MessageBroker {
    if (!MessageBroker.instance) {
      MessageBroker.instance = new MessageBroker();
    }
    return MessageBroker.instance;
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

  private handleMessage(event: any) {
    const data = this.isBrowser ? event.data : event;
    if (!data || typeof data !== 'object') return;

    if (data.type === 'asyar:response') {
      const response = data as IPCResponse;
      const pending = this.pendingRequests.get(response.messageId);
      if (pending) {
        clearTimeout(pending.timer);
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

  public invoke<T>(command: string, payload?: any, extensionId?: string, timeoutMs: number = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const messageId = this.generateId();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(new Error(`IPC timeout after ${timeoutMs}ms for command: ${command}`));
      }, timeoutMs);

      this.pendingRequests.set(messageId, { resolve, reject, timer });

      const message: IPCMessage = {
        type: `asyar:api:${command}`,
        payload: payload || {},
        messageId,
        ...(extensionId ? { extensionId } : {})
      };

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

  public on(event: string, listener: (payload: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  public off(event: string, listener: (payload: any) => void): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }
}
