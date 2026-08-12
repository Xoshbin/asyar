import { fetchUrl, wsConnect, wsSend, wsClose } from '../../lib/ipc/commands';

export class NetworkService {
  async fetch(
    callerExtensionId: string | null,
    url: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      timeout?: number;
    },
  ): Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    ok: boolean;
  }> {
    const result = await fetchUrl({
      url,
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
      timeoutMs: options?.timeout ?? 20000,
      callerExtensionId,
    });
    if (result === null) throw new Error('fetch_url failed');
    return result;
  }

  async wsConnect(
    callerExtensionId: string | null,
    socketId: string,
    url: string,
    headers?: Record<string, string>,
  ): Promise<boolean> {
    return wsConnect(socketId, url, headers, callerExtensionId);
  }

  async wsSend(
    callerExtensionId: string | null,
    socketId: string,
    message: string,
  ): Promise<boolean> {
    return wsSend(socketId, message, callerExtensionId);
  }

  async wsClose(
    callerExtensionId: string | null,
    socketId: string,
    code?: number,
    reason?: string,
  ): Promise<boolean> {
    return wsClose(socketId, code, reason, callerExtensionId);
  }
}

export const networkService = new NetworkService();
