import { Command } from 'commander'
import chalk from 'chalk'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { STORE_URL } from '../lib/auth'
import { getExtensionsDir } from '../lib/platform'

interface CheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

/**
 * Get the newest file modification time in a directory (recursive).
 * Skips node_modules and .git.
 */
function getNewestMtime(dir: string): number {
  let newest = 0
  if (!fs.existsSync(dir)) return 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue
      newest = Math.max(newest, getNewestMtime(fullPath))
    } else {
      newest = Math.max(newest, fs.statSync(fullPath).mtimeMs)
    }
  }
  return newest
}

/**
 * Walk up directories to find the monorepo root (has pnpm-workspace.yaml
 * that includes asyar-sdk).
 */
function findProjectRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  for (let i = 0; i < 10; i++) {
    const wsFile = path.join(dir, 'pnpm-workspace.yaml')
    const pkgFile = path.join(dir, 'package.json')
    if (fs.existsSync(wsFile) && fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))
        if (pkg.name === 'asyar-project') return dir
      } catch {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Find the asyar-sdk root directory by walking up from cwd.
 */
function findSdkRoot(startDir: string): string | null {
  // Check if we're inside asyar-sdk
  let dir = path.resolve(startDir)
  for (let i = 0; i < 10; i++) {
    const pkgFile = path.join(dir, 'package.json')
    if (fs.existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'))
        if (pkg.name === 'asyar-sdk') return dir
      } catch {}
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Check sibling directories from project root
  const projectRoot = findProjectRoot(startDir)
  if (projectRoot) {
    const sdkDir = path.join(projectRoot, 'asyar-sdk')
    if (fs.existsSync(path.join(sdkDir, 'package.json'))) {
      return sdkDir
    }
  }

  return null
}

export function registerDoctor(program: Command) {
  program
    .command('doctor')
    .description('Check environment health and diagnose common issues')
    .action(async () => {
      const results: CheckResult[] = []

      console.log(chalk.bold('\nAsyar Doctor\n'))

      // 1. Platform info
      console.log(`  OS:        ${os.platform()} ${os.arch()} (${os.release()})`)
      console.log(`  Node:      ${process.version}`)
      try {
        const pnpmVer = execSync('pnpm --version', { stdio: 'pipe' }).toString().trim()
        console.log(`  pnpm:      ${pnpmVer}`)
      } catch {
        console.log(`  pnpm:      ${chalk.red('not found')}`)
        results.push({ name: 'pnpm', status: 'fail', message: 'pnpm is not installed' })
      }
      console.log(`  Store URL: ${STORE_URL}`)
      console.log()

      // 2. SDK dist freshness
      const sdkRoot = findSdkRoot(process.cwd())
      if (sdkRoot) {
        const srcTime = Math.max(
          getNewestMtime(path.join(sdkRoot, 'src')),
          getNewestMtime(path.join(sdkRoot, 'cli'))
        )
        const distDir = path.join(sdkRoot, 'dist')
        if (fs.existsSync(distDir)) {
          const distTime = getNewestMtime(distDir)
          if (srcTime > distTime) {
            results.push({
              name: 'SDK build',
              status: 'warn',
              message: `dist/ is stale — run ${chalk.cyan('pnpm run build:all')} in asyar-sdk`
            })
          } else {
            results.push({ name: 'SDK build', status: 'ok', message: 'dist/ is up to date' })
          }
        } else {
          results.push({
            name: 'SDK build',
            status: 'fail',
            message: `dist/ not found — run ${chalk.cyan('pnpm run build:all')} in asyar-sdk`
          })
        }
      }

      // 3. Workspace link check
      const nmSdk = path.join(process.cwd(), 'node_modules', 'asyar-sdk')
      if (fs.existsSync(nmSdk)) {
        const stat = fs.lstatSync(nmSdk)
        if (stat.isSymbolicLink()) {
          const target = fs.realpathSync(nmSdk)
          results.push({ name: 'SDK link', status: 'ok', message: `workspace-linked → ${target}` })
        } else {
          results.push({
            name: 'SDK link',
            status: 'warn',
            message: `installed from npm (frozen copy) — run ${chalk.cyan('pnpm install')} from monorepo root to link`
          })
        }
      }

      // 4. Extensions directory
      const extDir = getExtensionsDir()
      if (fs.existsSync(extDir)) {
        const entries = fs.readdirSync(extDir).filter(f => !f.startsWith('.'))
        results.push({ name: 'Extensions dir', status: 'ok', message: `${extDir} (${entries.length} extensions)` })
      } else {
        results.push({ name: 'Extensions dir', status: 'warn', message: `${extDir} does not exist yet` })
      }

      // 5. Store reachability
      try {
        const resp = await fetch(`${STORE_URL}/api/extensions?per_page=1`, {
          signal: AbortSignal.timeout(5000)
        })
        if (resp.ok) {
          results.push({ name: 'Store', status: 'ok', message: `${STORE_URL} is reachable` })
        } else {
          results.push({ name: 'Store', status: 'warn', message: `${STORE_URL} responded with ${resp.status}` })
        }
      } catch {
        results.push({ name: 'Store', status: 'warn', message: `${STORE_URL} is not reachable` })
      }

      // 6. Monorepo detection
      const projectRoot = findProjectRoot(process.cwd())
      if (projectRoot) {
        results.push({ name: 'Monorepo', status: 'ok', message: `root at ${projectRoot}` })
      } else {
        results.push({
          name: 'Monorepo',
          status: 'warn',
          message: 'Not inside an Asyar monorepo — SDK uses npm version'
        })
      }

      // Print results
      for (const r of results) {
        const icon = r.status === 'ok'
          ? chalk.green('✓')
          : r.status === 'warn'
            ? chalk.yellow('⚠')
            : chalk.red('✗')
        console.log(`  ${icon} ${chalk.bold(r.name)}: ${r.message}`)
      }

      const failures = results.filter(r => r.status === 'fail')
      const warnings = results.filter(r => r.status === 'warn')
      console.log()
      if (failures.length > 0) {
        console.log(chalk.red(`  ${failures.length} issue(s) need attention.`))
        process.exit(1)
      } else if (warnings.length > 0) {
        console.log(chalk.yellow(`  ${warnings.length} warning(s) — see above.`))
      } else {
        console.log(chalk.green('  No issues found.'))
      }
      console.log()
    })
}
