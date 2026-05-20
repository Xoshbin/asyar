import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import {
  SIDECAR_PLATFORMS,
  resolvePlatform,
  resolveTargets,
  universalDarwinFromTargets,
} from './sidecar-platforms.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKFLOWS_DIR = resolve(__dirname, '..', '.github', 'workflows')

// Extract every Rust target triple referenced by every workflow under
// .github/workflows/. Covers three syntactic patterns:
//   1. `rust-target: <triple>`           (matrix entries)
//   2. `targets: <comma-separated>`      (dtolnay/rust-toolchain inputs)
//   3. `--target <triple>`               (cargo / tauri build commands)
// `universal-apple-darwin` is expanded into its two underlying triples.
function rustTargetsInWorkflows() {
  const targets = new Set()
  for (const file of readdirSync(WORKFLOWS_DIR)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue
    const text = readFileSync(resolve(WORKFLOWS_DIR, file), 'utf8')

    for (const m of text.matchAll(/rust-target:\s*([a-z0-9_-]+)/g)) {
      targets.add(m[1])
    }
    for (const m of text.matchAll(/^\s*targets:\s*([a-z0-9_,\s-]+)$/gm)) {
      for (const t of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        targets.add(t)
      }
    }
    for (const m of text.matchAll(/--target\s+([a-z0-9_-]+)/g)) {
      targets.add(m[1])
    }
  }
  if (targets.has('universal-apple-darwin')) {
    targets.delete('universal-apple-darwin')
    targets.add('aarch64-apple-darwin')
    targets.add('x86_64-apple-darwin')
  }
  return targets
}

describe('SIDECAR_PLATFORMS', () => {
  it('covers every Rust target referenced by the CI workflows', () => {
    const ciTargets = rustTargetsInWorkflows()
    expect(ciTargets.size).toBeGreaterThan(0) // sanity: we actually parsed something

    const supportedTriples = new Set(
      Object.values(SIDECAR_PLATFORMS).map((p) => p.rustTriple),
    )
    const missing = [...ciTargets].filter((t) => !supportedTriples.has(t))
    expect(missing).toEqual([])
  })

  it('resolves each Node `platform-arch` key to its full entry', () => {
    for (const [key, entry] of Object.entries(SIDECAR_PLATFORMS)) {
      const [platform, arch] = key.split('-')
      const resolved = resolvePlatform(platform, arch)
      expect(resolved.platformKey).toBe(key)
      expect(resolved.rustTriple).toBe(entry.rustTriple)
      expect(resolved.bunArchive).toBe(entry.bunArchive)
      expect(resolved.uvArchive).toBe(entry.uvArchive)
    }
  })

  it('throws with the supported list when given an unknown platform', () => {
    expect(() => resolvePlatform('haiku', 'mips')).toThrowError(
      /Unsupported platform: haiku-mips\. Supported: /,
    )
  })

  it('uses consistent archive naming conventions', () => {
    for (const entry of Object.values(SIDECAR_PLATFORMS)) {
      expect(entry.bunArchive).toMatch(/^bun-[a-z0-9-]+\.zip$/)
      expect(entry.uvArchive).toMatch(/^uv-[a-z0-9_-]+\.(zip|tar\.gz)$/)
      expect(entry.rustTriple).toMatch(/^[a-z0-9][a-z0-9_-]+[a-z0-9]$/)
    }
  })
})

describe('resolveTargets', () => {
  it('returns one platform entry for a single concrete Rust triple', () => {
    const r = resolveTargets(['aarch64-pc-windows-msvc'])
    expect(r.map((p) => p.platformKey)).toEqual(['win32-arm64'])
  })

  it('expands universal-apple-darwin into both darwin platforms', () => {
    const r = resolveTargets(['universal-apple-darwin'])
    expect(r.map((p) => p.platformKey).sort()).toEqual(['darwin-arm64', 'darwin-x64'])
  })

  it('dedupes when a meta-target overlaps with a concrete triple', () => {
    const r = resolveTargets(['universal-apple-darwin', 'x86_64-apple-darwin'])
    expect(r.map((p) => p.platformKey).sort()).toEqual(['darwin-arm64', 'darwin-x64'])
  })

  it('throws on an unknown Rust triple', () => {
    expect(() => resolveTargets(['mips64-unknown-linux-gnu'])).toThrowError(
      /Unsupported Rust target: mips64-unknown-linux-gnu/,
    )
  })

  it('returns full platform entries with rustTriple/bunArchive/uvArchive', () => {
    const [entry] = resolveTargets(['x86_64-unknown-linux-gnu'])
    expect(entry.rustTriple).toBe('x86_64-unknown-linux-gnu')
    expect(entry.bunArchive).toBe('bun-linux-x64.zip')
    expect(entry.uvArchive).toBe('uv-x86_64-unknown-linux-gnu.tar.gz')
  })
})

// Tauri's universal-apple-darwin build only lipos the main app binary —
// external sidecars are copied by file name with `-<target>` appended, so we
// have to pre-merge `bun-aarch64-apple-darwin` + `bun-x86_64-apple-darwin`
// into `bun-universal-apple-darwin` ourselves (and the same for uv).
describe('universalDarwinFromTargets', () => {
  it('returns null when universal-apple-darwin is not in the targets', () => {
    expect(universalDarwinFromTargets(['x86_64-apple-darwin'])).toBeNull()
    expect(universalDarwinFromTargets(['aarch64-unknown-linux-gnu'])).toBeNull()
    expect(universalDarwinFromTargets([])).toBeNull()
  })

  it('returns the merge plan when universal-apple-darwin is in the targets', () => {
    const plan = universalDarwinFromTargets(['universal-apple-darwin'])
    expect(plan).not.toBeNull()
    expect(plan.universalTriple).toBe('universal-apple-darwin')
    expect(plan.sourceTriples.sort()).toEqual([
      'aarch64-apple-darwin',
      'x86_64-apple-darwin',
    ])
  })

  it('still returns the merge plan when universal sits alongside other targets', () => {
    const plan = universalDarwinFromTargets([
      'universal-apple-darwin',
      'x86_64-unknown-linux-gnu',
    ])
    expect(plan).not.toBeNull()
    expect(plan.universalTriple).toBe('universal-apple-darwin')
  })
})
