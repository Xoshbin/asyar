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
 * Idempotent: skips download if the destination already exists.
 */

import { existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

import { resolvePlatform } from './sidecar-platforms.mjs'
import { download } from './http-download.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BINARIES_DIR = join(ROOT, 'src-tauri', 'binaries')

let platform
try {
  platform = resolvePlatform(process.platform, process.arch)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}

const { platformKey, rustTriple, bunArchive, uvArchive } = platform
const isWindows = process.platform === 'win32'
const exeExt = isWindows ? '.exe' : ''

function step(msg) {
  console.log(`\n-- ${msg} ${'-'.repeat(Math.max(0, 60 - msg.length))}`)
}

function findBinary(searchDir, binaryName) {
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

function extractArchive(archivePath, outDir) {
  mkdirSync(outDir, { recursive: true })
  if (archivePath.endsWith('.tar.gz')) {
    execFileSync('tar', ['-xzf', archivePath, '-C', outDir], { stdio: 'pipe' })
  } else if (isWindows) {
    execFileSync('tar', ['-xf', archivePath, '-C', outDir], { stdio: 'pipe' })
  } else {
    execFileSync('unzip', ['-o', archivePath, '-d', outDir], { stdio: 'pipe' })
  }
}

function makeExecutable(filePath) {
  if (!isWindows) chmodSync(filePath, 0o755)
}

async function ensureSidecar({ repo, archive, binaryName }) {
  const destName = `${binaryName}-${rustTriple}${exeExt}`
  const destPath = join(BINARIES_DIR, destName)

  if (existsSync(destPath)) {
    console.log(`  ${binaryName}: already exists at binaries/${destName}, skipping`)
    return
  }

  const url = `https://github.com/${repo}/releases/latest/download/${archive}`
  const tmpArchive = join(tmpdir(), archive)
  console.log(`  ${binaryName}: downloading ${archive} from GitHub...`)
  await download(url, tmpArchive)

  const tmpOut = join(tmpdir(), `${binaryName}-extract-${Date.now()}`)
  console.log(`  ${binaryName}: extracting...`)
  extractArchive(tmpArchive, tmpOut)

  const binaryFile = `${binaryName}${exeExt}`
  const extracted = findBinary(tmpOut, binaryFile)
  copyFileSync(extracted, destPath)
  makeExecutable(destPath)

  console.log(`  ${binaryName}: installed to binaries/${destName}`)
}

step(`Downloading sidecars for ${platformKey} (${rustTriple})`)
mkdirSync(BINARIES_DIR, { recursive: true })

await ensureSidecar({ repo: 'oven-sh/bun',    archive: bunArchive, binaryName: 'bun' })
await ensureSidecar({ repo: 'astral-sh/uv',   archive: uvArchive,  binaryName: 'uv'  })

console.log('\n  Sidecars ready.')
