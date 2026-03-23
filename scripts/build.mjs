#!/usr/bin/env node
/**
 * Full clean production build.
 * 1. Clean previous Tauri build output
 * 2. Build asyar-sdk (types + CLI)
 * 3. Run pnpm tauri build (Rust + frontend → native binary)
 *
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync } from 'child_process'
import { rmSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const launcherDir = resolve(root, 'asyar-launcher')

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: 'inherit' })
}

function step(msg) {
  console.log(`\n── ${msg} ${'─'.repeat(Math.max(0, 60 - msg.length))}`)
}

// 1. Clean
step('Cleaning previous build output')

const toClean = [
  resolve(launcherDir, 'src-tauri', 'target', 'release', 'bundle'),
  resolve(launcherDir, '.svelte-kit', 'output'),
  resolve(launcherDir, '.vite'),
]
for (const dir of toClean) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
    console.log(`  removed ${dir.replace(root + '/', '')}`)
  }
}

// 2. Build SDK
step('Building asyar-sdk')
try {
  run('pnpm run build:all', resolve(root, 'asyar-sdk'))
  console.log('✓ SDK built')
} catch {
  console.error('✗ SDK build failed')
  process.exit(1)
}

// 3. Tauri build (Rust + frontend)
step('Building asyar-launcher (pnpm tauri build)')
try {
  run('pnpm tauri build', launcherDir)
  console.log('\n✓ Build complete')
} catch {
  console.error('✗ Tauri build failed')
  process.exit(1)
}
