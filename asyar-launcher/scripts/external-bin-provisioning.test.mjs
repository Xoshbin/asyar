import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { PROVISIONED_SIDECARS } from './sidecar-platforms.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TAURI_CONF = resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json')

// Strip the `binaries/` prefix from each Tauri externalBin entry to get the
// bare sidecar name Tauri suffixes with `-<target-triple>` at bundle time.
function externalBinNames() {
  const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'))
  const list = conf.bundle?.externalBin ?? []
  return list.map((p) => p.replace(/^.*\//, ''))
}

// Guards the exact failure that broke every build job: `binaries/claude` was
// added to externalBin but never downloaded, so each platform aborted with
// "resource path 'binaries/claude-<triple>' doesn't exist". This test fails at
// `test-and-lint` time — before the build jobs ever run — if the two lists drift.
describe('externalBin ↔ sidecar provisioning', () => {
  it('declares an externalBin entry for every provisioned sidecar (and vice versa)', () => {
    const declared = [...externalBinNames()].sort()
    const provisioned = [...PROVISIONED_SIDECARS].sort()
    expect(provisioned).toEqual(declared)
  })
})
