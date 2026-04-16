import { fetchUrl } from '../../lib/ipc/commands'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { envService } from '../envService'

export class NetworkService {
  async fetch(
    callerExtensionId: string | null,
    url: string,
    options?: { method?: string; headers?: Record<string, string>; body?: string; timeout?: number },
  ): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string; ok: boolean }> {
    if (envService.isTauri) {
      return fetchUrl({
        url,
        method: options?.method ?? 'GET',
        headers: options?.headers,
        timeoutMs: options?.timeout ?? 20000,
        callerExtensionId,
      })
    }

    const res = await httpFetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
    })
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value
    })
    const body = await res.text()
    return {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body,
      ok: res.ok,
    }
  }
}
