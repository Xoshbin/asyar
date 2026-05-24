#!/usr/bin/env node
/**
 * Build all packages in dependency order.
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const steps = [
  { name: 'asyar-sdk', cwd: resolve(root, 'asyar-sdk'), cmd: 'pnpm run build:all' },
  { name: 'asyar-launcher (frontend)', cwd: resolve(root, 'asyar-launcher'), cmd: 'pnpm run build' },
]

for (const step of steps) {
  console.log(`\nBuilding ${step.name}...`)
  try {
    execSync(step.cmd, { cwd: step.cwd, stdio: 'inherit' })
    console.log(`✓ ${step.name}`)
  } catch {
    console.error(`✗ ${step.name} build failed`)
    process.exit(1)
  }
}

console.log('\n✓ All builds complete.')
