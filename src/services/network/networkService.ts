import { fetchUrl } from '../../lib/ipc/commands'

export class NetworkService {
  async fetch(
    callerExtensionId: string | null,
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
  ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; ok: boolean }> {
    return fetchUrl({
      url,
      method: options?.method ?? 'GET',
      headers: options?.headers,
      timeoutMs: options?.timeout ?? 20000,
      callerExtensionId,
    })
  }
}

export const networkService = new NetworkService()
