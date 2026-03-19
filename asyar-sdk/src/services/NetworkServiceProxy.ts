import type { INetworkService, RequestOptions, NetworkResponse } from '../types/NetworkType';
import { MessageBroker } from "../ipc/MessageBroker";

export class NetworkServiceProxy implements INetworkService {
  private broker: MessageBroker;
  private extensionId?: string;

  constructor() {
    this.broker = MessageBroker.getInstance();
  }

  setExtensionId(id: string) {
    this.extensionId = id;
    const originalInvoke = this.broker.invoke.bind(this.broker);
    this.broker = Object.create(this.broker);
    this.broker.invoke = <T>(command: string, payload?: any) => originalInvoke(command, payload, id);
  }

  async fetch(url: string, options?: RequestOptions): Promise<NetworkResponse> {
    const invokePromise = this.broker.invoke('network:fetch', { url, options: options ?? {} });
    // Allow the host's AbortController (driven by options.timeout) to fire and send back
    // an error response before we give up. Add a generous 15s buffer on top.
    const ipcTimeout = (options?.timeout ?? 25000) + 15000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`IPC Request timed out after ${ipcTimeout}ms`)), ipcTimeout)
    );
    return Promise.race([invokePromise, timeoutPromise]) as Promise<NetworkResponse>;
  }
}
