#!/usr/bin/env node
/**
 * Download bundled bun + uv sidecars for the current platform.
 *
 * Places platform-suffixed binaries in:
 *   src-tauri/binaries/
 *
 * Run from the repo root:
 *   node scripts/download-sidecars.mjs
 *
 * Idempotent: skips download if the file already exists.
 */

import { createWriteStream, existsSync, chmodSync, mkdirSync, copyFileSync } from 'fs'
import { get } from 'https'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BINARIES_DIR = join(ROOT, 'src-tauri', 'binaries')

// ── Platform detection ────────────────────────────────────────────────────────

const RUST_TRIPLES = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64':   'x86_64-apple-darwin',
  'linux-x64':    'x86_64-unknown-linux-gnu',
  'linux-arm64':  'aarch64-unknown-linux-gnu',
  'win32-x64':    'x86_64-pc-windows-msvc',
}

const BUN_ARCHIVE_NAMES = {
  'darwin-arm64': 'bun-darwin-aarch64.zip',
  'darwin-x64':   'bun-darwin-x64.zip',
  'linux-x64':    'bun-linux-x64.zip',
  'linux-arm64':  'bun-linux-aarch64.zip',
  'win32-x64':    'bun-windows-x64.zip',
}

const UV_ARCHIVE_NAMES = {
  'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
  'darwin-x64':   'uv-x86_64-apple-darwin.tar.gz',
  'linux-x64':    'uv-x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64':  'uv-aarch64-unknown-linux-gnu.tar.gz',
  'win32-x64':    'uv-x86_64-pc-windows-msvc.zip',
}

const platformKey = `${process.platform}-${process.arch}`
const rustTriple = RUST_TRIPLES[platformKey]

if (!rustTriple) {
  console.error(`Unsupported platform: ${platformKey}`)
  console.error(`Supported: ${Object.keys(RUST_TRIPLES).join(', ')}`)
  process.exit(1)
}

const isWindows = process.platform === 'win32'

// ── Helpers ───────────────────────────────────────────────────────────────────

function step(msg) {
  console.log(`\n-- ${msg} ${'-'.repeat(Math.max(0, 60 - msg.length))}`)
}

/**
 * Download a URL to a local file, following redirects.
 */
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const request = (u) => {
      get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.close()
          return request(res.headers.location)
        }
        if (res.statusCode !== 200) {
          file.close()
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

/**
 * Find a binary by name inside a directory tree.
 * Returns the first match or throws.
 */
function findBinary(searchDir, binaryName) {
  // Use execFileSync with find/where to avoid shell injection — all args are
  // hardcoded constants, not user input.
  let output
  if (isWindows) {
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

/**
 * Extract a .zip archive to outDir.
 */
function extractZip(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true })
  if (isWindows) {
    execFileSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', archivePath, '-d', outDir], { stdio: 'pipe' })
  }
}

/**
 * Extract a .tar.gz archive to outDir.
 */
function extractTarGz(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true })
  execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'pipe' })
}

function makeExecutable(filePath) {
  if (!isWindows) {
    chmodSync(filePath, 0o755)
  }
}

// ── Download bun ──────────────────────────────────────────────────────────────

async function downloadBun() {
  const archiveName = BUN_ARCHIVE_NAMES[platformKey]
  const url = `https://github.com/oven-sh/bun/releases/latest/download/${archiveName}`
  const ext = isWindows ? '.exe' : ''
  const destName = `bun-${rustTriple}${ext}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  bun: already exists at binaries/${destName}, skipping`)
    return
  }

  console.log(`  bun: downloading ${archiveName} from GitHub...`)
  const tmpArchive = join(tmpdir(), archiveName)
  await download(url, tmpArchive)
  console.log(`  bun: extracting...`)

  const tmpOut = join(tmpdir(), `bun-extract-${Date.now()}`)
  const bunBinaryName = isWindows ? 'bun.exe' : 'bun'
  extractZip(tmpArchive, tmpOut)
  const extracted = findBinary(tmpOut, bunBinaryName)

  copyFileSync(extracted, destPath)
  makeExecutable(destPath)

  console.log(`  bun: installed to binaries/${destName}`)
}

// ── Download uv ───────────────────────────────────────────────────────────────

async function downloadUv() {
  const archiveName = UV_ARCHIVE_NAMES[platformKey]
  const url = `https://github.com/astral-sh/uv/releases/latest/download/${archiveName}`
  const ext = isWindows ? '.exe' : ''
  const destName = `uv-${rustTriple}${ext}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  uv: already exists at binaries/${destName}, skipping`)
    return
  }

  console.log(`  uv: downloading ${archiveName} from GitHub...`)
  const tmpArchive = join(tmpdir(), archiveName)
  await download(url, tmpArchive)
  console.log(`  uv: extracting...`)

  const tmpOut = join(tmpdir(), `uv-extract-${Date.now()}`)
  const uvBinaryName = isWindows ? 'uv.exe' : 'uv'

  if (archiveName.endsWith('.tar.gz')) {
    extractTarGz(tmpArchive, tmpOut)
  } else {
    // win32: .zip
    extractZip(tmpArchive, tmpOut)
  }
  const extracted = findBinary(tmpOut, uvBinaryName)

  copyFileSync(extracted, destPath)
  makeExecutable(destPath)

  console.log(`  uv: installed to binaries/${destName}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

step(`Downloading sidecars for ${platformKey} (${rustTriple})`)

mkdirSync(BINARIES_DIR, { recursive: true })

await downloadBun()
await downloadUv()

console.log('\n  Sidecars ready.')
