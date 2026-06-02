#!/usr/bin/env node
/**
 * Download bundled bun + uv + claude sidecars for one or more Rust targets.
 *
 * Places platform-suffixed binaries in:
 *   src-tauri/binaries/
 *
 * Usage:
 *   node scripts/download-sidecars.mjs
 *     → provision sidecars for the current Node platform-arch
 *
 *   node scripts/download-sidecars.mjs --target <rust-triple>[,<rust-triple>...]
 *     → provision sidecars for the given Rust target(s). The meta-target
 *       `universal-apple-darwin` expands into both Apple Silicon and
 *       Intel macOS sidecars (Tauri's universal build needs both).
 *
 * The `claude` runtime (bundled so the AI extension builder can spawn the
 * Agent SDK without a system install) is pulled from downloads.claude.ai by
 * version + per-platform SHA-256 checksum. Pin a specific build with
 * CLAUDE_CODE_VERSION=<x.y.z>; otherwise the `latest` pointer is used.
 *
 * Idempotent: skips any destination file that already exists.
 */

import { existsSync, chmodSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'

import {
  PROVISIONED_SIDECARS,
  resolvePlatform,
  resolveTargets,
  universalDarwinFromTargets,
} from './sidecar-platforms.mjs'
import { download } from './http-download.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BINARIES_DIR = join(ROOT, 'src-tauri', 'binaries')

// Official native claude distribution (same source as the claude.ai installer).
const CLAUDE_BASE_URL = 'https://downloads.claude.ai/claude-code-releases'

const isWindowsRunner = process.platform === 'win32'

function parseTargets(argv) {
  const out = []
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--target' || a === '-t') {
      const next = argv[++i]
      if (!next) throw new Error('--target requires a value')
      out.push(...next.split(',').map((s) => s.trim()).filter(Boolean))
    } else if (a.startsWith('--target=')) {
      out.push(...a.slice('--target='.length).split(',').map((s) => s.trim()).filter(Boolean))
    } else {
      throw new Error(`Unknown argument: ${a}`)
    }
  }
  return out
}

function step(msg) {
  console.log(`\n-- ${msg} ${'-'.repeat(Math.max(0, 60 - msg.length))}`)
}

function findBinary(searchDir, binaryName) {
  let output
  if (isWindowsRunner) {
    output = execFileSync('cmd', ['/c', 'dir', '/s', '/b', join(searchDir, binaryName)], {
      stdio: 'pipe',
    }).toString()
  } else {
    output = execFileSync('find', [searchDir, '-name', binaryName, '-type', 'f'], {
      stdio: 'pipe',
    }).toString()
  }
  const lines = output.trim().split('\n').filter(Boolean)
  if (lines.length === 0) {
    throw new Error(`${binaryName} not found under ${searchDir}`)
  }
  return lines[0]
}

function extractArchive(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true })
  if (archivePath.endsWith('.tar.gz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'pipe' })
  } else if (isWindowsRunner) {
    execFileSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', archivePath, '-d', outDir], { stdio: 'pipe' })
  }
}

async function ensureSidecar(platform, { repo, archive, binaryName }) {
  const isWindowsTarget = platform.platformKey.startsWith('win32-')
  const exeExt = isWindowsTarget ? '.exe' : ''
  const destName = `${binaryName}-${platform.rustTriple}${exeExt}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  ${binaryName} (${platform.platformKey}): already exists at binaries/${destName}, skipping`)
    return
  }

  const url = `https://github.com/${repo}/releases/latest/download/${archive}`
  const tmpArchive = join(tmpdir(), `${platform.platformKey}-${archive}`)
  console.log(`  ${binaryName} (${platform.platformKey}): downloading ${archive}...`)
  await download(url, tmpArchive)

  const tmpOut = join(tmpdir(), `${binaryName}-${platform.rustTriple}-extract-${Date.now()}`)
  console.log(`  ${binaryName} (${platform.platformKey}): extracting...`)
  extractArchive(tmpArchive, tmpOut)

  const innerName = `${binaryName}${exeExt}`
  const extracted = findBinary(tmpOut, innerName)
  copyFileSync(extracted, destPath)
  if (!isWindowsTarget) chmodSync(destPath, 0o755)

  console.log(`  ${binaryName} (${platform.platformKey}): installed to binaries/${destName}`)
}

function lipoUniversal({ universalTriple, sourceTriples }, binaryName) {
  const destName = `${binaryName}-${universalTriple}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  ${binaryName} (${universalTriple}): already exists at binaries/${destName}, skipping`)
    return
  }

  const sources = sourceTriples.map((t) => join(BINARIES_DIR, `${binaryName}-${t}`))
  for (const src of sources) {
    if (!existsSync(src)) {
      throw new Error(`lipo source missing: ${src} (needed to build ${destName})`)
    }
  }

  console.log(`  ${binaryName} (${universalTriple}): lipo -create from ${sourceTriples.join(' + ')}...`)
  execFileSync('lipo', ['-create', '-output', destPath, ...sources], { stdio: 'pipe' })
  chmodSync(destPath, 0o755)
  console.log(`  ${binaryName} (${universalTriple}): installed to binaries/${destName}`)
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

// Download `url` to a temp file and return its text contents (for the version
// pointer and manifest, which the file-based `download` helper handles with the
// same redirect/TLS logic as the binaries).
async function downloadText(url, label) {
  const tmp = join(tmpdir(), `claude-${label}-${Date.now()}`)
  await download(url, tmp)
  return readFileSync(tmp, 'utf8')
}

// Resolve the claude version to bundle: an explicit CLAUDE_CODE_VERSION pin, or
// the `latest` pointer. Validated to a bare semver so an HTML error page can't
// flow into the manifest/binary URLs.
async function resolveClaudeVersion() {
  const pinned = process.env.CLAUDE_CODE_VERSION?.trim()
  const version = pinned || (await downloadText(`${CLAUDE_BASE_URL}/latest`, 'latest')).trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Unexpected claude version "${version}" (from ${pinned ? 'CLAUDE_CODE_VERSION' : `${CLAUDE_BASE_URL}/latest`})`)
  }
  return version
}

async function fetchClaudeManifest(version) {
  const json = await downloadText(`${CLAUDE_BASE_URL}/${version}/manifest.json`, `manifest-${version}`)
  return JSON.parse(json)
}

async function ensureClaude(platform, version, manifest) {
  const isWindowsTarget = platform.platformKey.startsWith('win32-')
  const exeExt = isWindowsTarget ? '.exe' : ''
  const destName = `claude-${platform.rustTriple}${exeExt}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  claude (${platform.platformKey}): already exists at binaries/${destName}, skipping`)
    return
  }

  const claudeKey = platform.claudePlatform
  const expected = manifest.platforms?.[claudeKey]?.checksum
  if (!expected) {
    throw new Error(`claude manifest ${version} has no checksum for platform "${claudeKey}"`)
  }

  const binFile = `claude${exeExt}`
  const url = `${CLAUDE_BASE_URL}/${version}/${claudeKey}/${binFile}`
  const tmpBin = join(tmpdir(), `${destName}-dl-${Date.now()}`)
  console.log(`  claude (${platform.platformKey}): downloading ${version}/${claudeKey}...`)
  await download(url, tmpBin)

  const actual = sha256(tmpBin)
  if (actual !== expected) {
    throw new Error(`claude (${claudeKey}) checksum mismatch: expected ${expected}, got ${actual}`)
  }

  copyFileSync(tmpBin, destPath)
  if (!isWindowsTarget) chmodSync(destPath, 0o755)
  console.log(`  claude (${platform.platformKey}): installed to binaries/${destName} (verified)`)
}

let cliTargets
let platforms
try {
  cliTargets = parseTargets(process.argv)
  platforms = cliTargets.length
    ? resolveTargets(cliTargets)
    : [resolvePlatform(process.platform, process.arch)]
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const keysLabel = platforms.map((p) => p.platformKey).join(', ')
step(`Downloading sidecars for ${keysLabel}`)
mkdirSync(BINARIES_DIR, { recursive: true })

step('Resolving claude runtime version')
const claudeVersion = await resolveClaudeVersion()
const claudeManifest = await fetchClaudeManifest(claudeVersion)
console.log(`  claude runtime: ${claudeVersion}`)

for (const platform of platforms) {
  await ensureSidecar(platform, {
    repo: 'oven-sh/bun',
    archive: platform.bunArchive,
    binaryName: 'bun',
  })
  await ensureSidecar(platform, {
    repo: 'astral-sh/uv',
    archive: platform.uvArchive,
    binaryName: 'uv',
  })
  await ensureClaude(platform, claudeVersion, claudeManifest)
}

const universal = universalDarwinFromTargets(cliTargets)
if (universal) {
  // claude's compiled JS payload lives in a `__BUN` Mach-O segment, so each arch
  // slice stays self-contained through lipo — same as the bun/uv runtimes.
  step(`Merging universal-apple-darwin sidecars via lipo`)
  for (const binaryName of PROVISIONED_SIDECARS) {
    lipoUniversal(universal, binaryName)
  }
}

console.log('\n  Sidecars ready.')
