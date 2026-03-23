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

console.log('Building asyar-sdk...')
try {
  execSync('pnpm run build:all', {
    cwd: resolve(root, 'asyar-sdk'),
    stdio: 'inherit'
  })
  console.log('✓ SDK built\n')
} catch {
  console.error('✗ SDK build failed')
  process.exit(1)
}

console.log('Starting asyar app...\n')
const child = spawn('pnpm', ['dev'], {
  cwd: resolve(root, 'asyar-launcher'),
  stdio: 'inherit',
  shell: true
})

child.on('exit', (code) => process.exit(code ?? 0))
