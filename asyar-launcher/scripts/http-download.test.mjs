import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'

import { download } from './http-download.mjs'

class FakeResponse extends Readable {
  constructor({ statusCode, headers = {}, body = Buffer.alloc(0) }) {
    super()
    this.statusCode = statusCode
    this.headers = headers
    this._payload = body
    this._sent = false
  }
  _read() {
    if (this._sent) return
    this._sent = true
    if (this._payload.length) this.push(this._payload)
    this.push(null)
  }
}

// Returns a fake `https.get`-style function that consumes one scripted step
// per request. Each request yields a `FakeResponse` on the next tick, like
// the real Node http client.
function scriptedGet(steps) {
  const queue = [...steps]
  return function (_url, cb) {
    const step = queue.shift()
    if (!step) throw new Error(`Unexpected extra HTTP request`)
    const req = new EventEmitter()
    setImmediate(() => cb(new FakeResponse(step)))
    return req
  }
}

describe('download()', () => {
  let dir
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sidecar-dl-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes the body to disk on a direct 200', async () => {
    const dest = join(dir, 'out.bin')
    const body = Buffer.from('hello world')
    await download('https://example.invalid/file', dest, {
      getImpl: scriptedGet([{ statusCode: 200, body }]),
    })
    expect(readFileSync(dest)).toEqual(body)
  })

  it('follows a multi-hop 302 redirect chain to the final 200', async () => {
    // This is the GitHub releases redirect pattern (latest → tagged → CDN)
    // that hung CI with the previous downloader implementation.
    const dest = join(dir, 'out.bin')
    const body = Buffer.from('payload-after-redirects')
    await download('https://example.invalid/start', dest, {
      getImpl: scriptedGet([
        { statusCode: 302, headers: { location: 'https://example.invalid/mid' } },
        { statusCode: 302, headers: { location: 'https://example.invalid/final' } },
        { statusCode: 200, body },
      ]),
    })
    expect(readFileSync(dest)).toEqual(body)
  })

  it('handles 307 and 308 redirects in addition to 301/302/303', async () => {
    const dest = join(dir, 'out.bin')
    const body = Buffer.from('all-redirect-codes')
    await download('https://example.invalid/a', dest, {
      getImpl: scriptedGet([
        { statusCode: 301, headers: { location: 'https://example.invalid/b' } },
        { statusCode: 303, headers: { location: 'https://example.invalid/c' } },
        { statusCode: 307, headers: { location: 'https://example.invalid/d' } },
        { statusCode: 308, headers: { location: 'https://example.invalid/e' } },
        { statusCode: 200, body },
      ]),
    })
    expect(readFileSync(dest)).toEqual(body)
  })

  it('resolves relative Location headers against the request URL', async () => {
    const dest = join(dir, 'out.bin')
    const body = Buffer.from('relative-loc')
    await download('https://example.invalid/dir/file', dest, {
      getImpl: scriptedGet([
        { statusCode: 302, headers: { location: '/elsewhere' } },
        { statusCode: 200, body },
      ]),
    })
    expect(readFileSync(dest)).toEqual(body)
  })

  it('rejects on non-200 final response without creating the destination file', async () => {
    const dest = join(dir, 'out.bin')
    await expect(
      download('https://example.invalid/x', dest, {
        getImpl: scriptedGet([{ statusCode: 404 }]),
      }),
    ).rejects.toThrow(/HTTP 404/)
    expect(existsSync(dest)).toBe(false)
  })

  it('rejects on a non-200 response after a redirect, without leaving a partial file', async () => {
    const dest = join(dir, 'out.bin')
    await expect(
      download('https://example.invalid/y', dest, {
        getImpl: scriptedGet([
          { statusCode: 302, headers: { location: 'https://example.invalid/z' } },
          { statusCode: 500 },
        ]),
      }),
    ).rejects.toThrow(/HTTP 500/)
    expect(existsSync(dest)).toBe(false)
  })

  it('rejects on a redirect loop exceeding maxRedirects', async () => {
    const dest = join(dir, 'out.bin')
    const loop = { statusCode: 302, headers: { location: 'https://example.invalid/loop' } }
    await expect(
      download('https://example.invalid/loop', dest, {
        getImpl: scriptedGet(Array(20).fill(loop)),
        maxRedirects: 3,
      }),
    ).rejects.toThrow(/Too many redirects/)
  })

  it('rejects on a redirect missing the Location header', async () => {
    const dest = join(dir, 'out.bin')
    await expect(
      download('https://example.invalid/missing-loc', dest, {
        getImpl: scriptedGet([{ statusCode: 302 }]),
      }),
    ).rejects.toThrow(/Redirect with no Location header/)
  })
})
