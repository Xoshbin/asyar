#!/usr/bin/env node
/**
 * Build the SDK then start the Asyar app in development mode.
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync, spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

console.log('Building asyar-sdk once to initialize dist/...')
try {
  execSync('pnpm run build:all', {
    cwd: resolve(root, 'asyar-sdk'),
    stdio: 'inherit'
  })
} catch {
  process.exit(1)
}

console.log('Starting development mode (SDK Watch + Launcher)...')

const sdkWatch = spawn('pnpm', ['run', 'watch'], {
  cwd: resolve(root, 'asyar-sdk'),
  stdio: 'inherit',
  shell: true
})

const launcherDev = spawn('pnpm', ['tauri', 'dev'], {
  cwd: resolve(root, 'asyar-launcher'),
  stdio: 'inherit',
  shell: true
})

// Ensure both exit when one stops
const cleanup = (code) => {
  sdkWatch.kill()
  launcherDev.kill()
  process.exit(code ?? 0)
}

sdkWatch.on('exit', cleanup)
launcherDev.on('exit', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
