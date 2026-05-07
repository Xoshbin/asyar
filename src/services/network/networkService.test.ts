import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetchUrl = vi.hoisted(() => vi.fn())

vi.mock('../../lib/ipc/commands', () => ({
  fetchUrl: mockFetchUrl,
}))

vi.mock('../log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { NetworkService } from './networkService'

function makeSvc() {
  return new NetworkService()
}

describe('NetworkService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
