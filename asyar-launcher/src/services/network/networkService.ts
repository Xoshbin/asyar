import { fetchUrl } from '../../lib/ipc/commands'

export class NetworkService {
  async fetch(
    callerExtensionId: string | null,
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
  ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; ok: boolean }> {
    const result = await fetchUrl({
      url,
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
      timeoutMs: options?.timeout ?? 20000,
      callerExtensionId,
    })
    if (result === null) throw new Error('fetch_url failed')
    return result
  }
}

export const networkService = new NetworkService()
