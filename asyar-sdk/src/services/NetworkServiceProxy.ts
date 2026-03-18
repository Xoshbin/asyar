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
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('IPC Request timed out after 10s')), 10000));
    return Promise.race([invokePromise, timeoutPromise]) as Promise<NetworkResponse>;
  }
}
