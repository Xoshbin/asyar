import type { INetworkService, RequestOptions, NetworkResponse } from '../types/NetworkType';
import { BaseServiceProxy } from "./BaseServiceProxy";

export class NetworkServiceProxy extends BaseServiceProxy implements INetworkService {
  async fetch(url: string, options?: RequestOptions): Promise<NetworkResponse> {
    const invokePromise = this.broker.invoke('network:fetch', { url, options: options ?? {} });
    const ipcTimeout = (options?.timeout ?? 25000) + 15000;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`IPC Request timed out after ${ipcTimeout}ms`)), ipcTimeout)
    );
    return Promise.race([invokePromise, timeoutPromise]) as Promise<NetworkResponse>;
  }
}

