#!/usr/bin/env node
/**
 * Asyar Development Workspace Setup
 *
 * Clones all required repositories, configures pnpm workspace linking,
 * installs dependencies, builds the SDK, and verifies the setup.
 *
 * Usage:
 *   git clone https://github.com/Xoshbin/asyar.git
 *   cd asyar
 *   node setup.mjs
 *
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname)

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

function step(msg) {
  console.log(`\n── ${msg} ${'─'.repeat(Math.max(0, 60 - msg.length))}`)
}

// ── Preflight checks ─────────────────────────────────────────────────────────

step('Checking prerequisites')

const checks = [
  { cmd: 'node --version', name: 'Node.js', minVersion: '20' },
  { cmd: 'pnpm --version', name: 'pnpm', minVersion: '9' },
  { cmd: 'rustc --version', name: 'Rust' },
  { cmd: 'cargo --version', name: 'Cargo' },
]

let preflight = true
for (const check of checks) {
  try {
    const ver = execSync(check.cmd, { stdio: 'pipe' }).toString().trim()
    const major = ver.match(/(\d+)/)?.[1]
    if (check.minVersion && major && parseInt(major) < parseInt(check.minVersion)) {
      console.error(`  ✗ ${check.name}: ${ver} (need ${check.minVersion}+)`)
      preflight = false
    } else {
      console.log(`  ✓ ${check.name}: ${ver}`)
    }
  } catch {
    console.error(`  ✗ ${check.name}: not found`)
    preflight = false
  }
}

if (!preflight) {
  console.error('\nMissing prerequisites. See https://github.com/Xoshbin/asyar#prerequisites')
  process.exit(1)
}

// ── Clone repositories ───────────────────────────────────────────────────────

step('Cloning repositories')

const repos = [
  { name: 'asyar-launcher', url: 'https://github.com/Xoshbin/asyar-launcher.git' },
  { name: 'asyar-sdk', url: 'https://github.com/Xoshbin/asyar-sdk.git' },
]

for (const repo of repos) {
  const dir = resolve(root, repo.name)
  if (existsSync(dir)) {
    console.log(`  ✓ ${repo.name}/ already exists, skipping`)
  } else {
    console.log(`  Cloning ${repo.name}...`)
    run(`git clone ${repo.url} ${repo.name}`)
    console.log(`  ✓ ${repo.name}`)
  }
}

// Create extensions directory
const extDir = resolve(root, 'extensions')
if (!existsSync(extDir)) {
  mkdirSync(extDir, { recursive: true })
  console.log('  ✓ extensions/ created')
} else {
  console.log('  ✓ extensions/ already exists')
}

// ── Install dependencies ─────────────────────────────────────────────────────

step('Installing dependencies (pnpm install)')

run('pnpm install')

console.log('  ✓ Dependencies installed and SDK workspace-linked')

// ── Verify setup ─────────────────────────────────────────────────────────────

step('Verifying setup (asyar doctor)')

try {
  run('node dist/cli/index.js doctor', { cwd: resolve(root, 'asyar-sdk') })
} catch {
  console.error('\n⚠ Doctor reported issues — see above for details.')
  console.error('  The workspace is installed but may need manual fixes.')
  process.exit(1)
}

// ── Done ─────────────────────────────────────────────────────────────────────

console.log(`
${'─'.repeat(64)}

  ✓ Asyar development workspace is ready!

  Quick start:
    pnpm dev          Build SDK and start the app
    pnpm build:all    Build everything
    pnpm check        Run doctor + type checks

  Docs:
    https://github.com/Xoshbin/asyar

${'─'.repeat(64)}
`)
