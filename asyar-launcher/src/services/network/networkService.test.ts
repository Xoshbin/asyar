import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchUrl = vi.hoisted(() => vi.fn())
const mockHttpFetch = vi.hoisted(() => vi.fn())

vi.mock('../../lib/ipc/commands', () => ({
  fetchUrl: mockFetchUrl,
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mockHttpFetch,
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../envService', () => ({
  envService: { isTauri: true, isBrowser: false },
}))

import { NetworkService } from './networkService'
import { envService } from '../envService'

function makeSvc() {
  return new NetworkService()
}

describe('NetworkService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(envService).isTauri = true
  })

  describe('fetch — Tauri mode', () => {
    it('delegates to commands.fetchUrl with correct params', async () => {
      const expected = { status: 200, statusText: 'OK', headers: {}, body: '{}', ok: true }
      mockFetchUrl.mockResolvedValueOnce(expected)

      const result = await makeSvc().fetch('org.test.ext', 'https://api.example.com', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      })

      expect(mockFetchUrl).toHaveBeenCalledWith({
        url: 'https://api.example.com',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 5000,
        callerExtensionId: 'org.test.ext',
      })
      expect(result).toEqual(expected)
    })

    it('uses default method GET and timeout 20000 when options omitted', async () => {
      const expected = { status: 200, statusText: 'OK', headers: {}, body: '', ok: true }
      mockFetchUrl.mockResolvedValueOnce(expected)

      await makeSvc().fetch('org.test.ext', 'https://example.com')

      expect(mockFetchUrl).toHaveBeenCalledWith({
        url: 'https://example.com',
        method: 'GET',
        headers: undefined,
        timeoutMs: 20000,
        callerExtensionId: 'org.test.ext',
      })
    })

    it('passes null callerExtensionId when null is given', async () => {
      mockFetchUrl.mockResolvedValueOnce({ status: 200, statusText: 'OK', headers: {}, body: '', ok: true })

      await makeSvc().fetch(null, 'https://example.com')

      expect(mockFetchUrl).toHaveBeenCalledWith(
        expect.objectContaining({ callerExtensionId: null }),
      )
    })
  })

  describe('fetch — browser mode', () => {
    beforeEach(() => {
      vi.mocked(envService).isTauri = false
    })

    it('uses httpFetch and constructs NetworkResponse shape', async () => {
      const mockHeaders = new Map([['content-type', 'text/plain']])
      mockHttpFetch.mockResolvedValueOnce({
        status: 200,
        statusText: 'OK',
        ok: true,
        headers: { forEach: (cb: (v: string, k: string) => void) => mockHeaders.forEach((v, k) => cb(v, k)) },
        text: () => Promise.resolve('hello'),
      })

      const result = await makeSvc().fetch('org.test.ext', 'https://example.com', {
        method: 'GET',
        headers: { Accept: 'text/plain' },
        body: 'test',
      })

      expect(mockHttpFetch).toHaveBeenCalledWith('https://example.com', {
        method: 'GET',
        headers: { Accept: 'text/plain' },
        body: 'test',
      })
      expect(result).toEqual({
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
        ok: true,
      })
    })

    it('does not call commands.fetchUrl', async () => {
      mockHttpFetch.mockResolvedValueOnce({
        status: 200, statusText: 'OK', ok: true,
        headers: { forEach: vi.fn() },
        text: () => Promise.resolve(''),
      })

      await makeSvc().fetch('org.test.ext', 'https://example.com')
      expect(mockFetchUrl).not.toHaveBeenCalled()
    })
  })
})
