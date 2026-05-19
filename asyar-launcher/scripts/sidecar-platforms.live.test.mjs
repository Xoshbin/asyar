// Network-dependent contract test: every archive name we ship in
// SIDECAR_PLATFORMS must resolve to an HTTP 200 from the matching upstream
// `/releases/latest/download/` endpoint. Catches typos against the upstream
// naming scheme (e.g. bun's `windows-aarch64`, not `windows-arm64`) before
// they hit CI.
//
// Set `SKIP_LIVE_SIDECAR_CHECKS=1` to skip when offline.

import { describe, it, expect } from 'vitest'
import { request } from 'node:https'
import { SIDECAR_PLATFORMS } from './sidecar-platforms.mjs'

const SKIP = process.env.SKIP_LIVE_SIDECAR_CHECKS === '1'

function headStatus(url, redirectsLeft = 10) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      { method: 'HEAD', host: u.host, path: u.pathname + u.search },
      (res) => {
        const { statusCode, headers } = res
        res.resume()
        if ([301, 302, 303, 307, 308].includes(statusCode)) {
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'))
          const next = new URL(headers.location, url).toString()
          return resolve(headStatus(next, redirectsLeft - 1))
        }
        resolve(statusCode)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

const cases = []
for (const [key, entry] of Object.entries(SIDECAR_PLATFORMS)) {
  cases.push([
    `bun for ${key}`,
    `https://github.com/oven-sh/bun/releases/latest/download/${entry.bunArchive}`,
  ])
  cases.push([
    `uv for ${key}`,
    `https://github.com/astral-sh/uv/releases/latest/download/${entry.uvArchive}`,
  ])
}

describe.skipIf(SKIP)('SIDECAR_PLATFORMS archives are reachable upstream', () => {
  for (const [label, url] of cases) {
    it(`${label} resolves to HTTP 200`, async () => {
      const status = await headStatus(url)
      expect(status, `${url} returned ${status}`).toBe(200)
    }, 15000)
  }
})
