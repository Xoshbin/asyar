import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { readManifest, validateManifest } from '../lib/manifest'

export function registerBuild(program: Command) {
  program
    .command('build')
    .description('Build extension for production')
    .option('--skip-validate', 'Skip manifest validation before building')
    .action(async (opts) => {
      const cwd = process.cwd()
      const manifest = readManifest(cwd)

      if (manifest.type === 'theme') {
        console.log(chalk.green('✓') + ' Theme extension — no build step needed.')
        console.log(chalk.gray('  Run "asyar publish" to package and publish your theme.'))
        process.exit(0)
      }

      if (!opts.skipValidate) {
        const errors = validateManifest(manifest, cwd)
        if (errors.length > 0) {
          console.log(chalk.red('✗ Validation failed:'))
          errors.forEach((e) => console.log(chalk.red(`  ✗ ${e.field}: ${e.message}`)))
          process.exit(1)
        }
        console.log(chalk.green('✓ Validation passed'))
      }

      try {
        await runViteBuild(cwd)
        verifyBuildOutput(cwd, manifest)
      } catch {
        process.exit(1)
      }
    })
}

export async function runViteBuild(cwd: string): Promise<void> {
  const spinner = ora('Building extension...').start()

  return new Promise((resolve, reject) => {
    const viteBin = path.join(cwd, 'node_modules', '.bin', 'vite')
    const child = spawn(viteBin, ['build', '--base', './'], { cwd, stdio: 'pipe', shell: true })

    let output = ''
    child.stdout.on('data', (d) => { output += d.toString() })
    child.stderr.on('data', (d) => { output += d.toString() })

    child.on('close', (code) => {
      if (code === 0) {
        spinner.succeed('Build complete')
        resolve()
      } else {
        spinner.fail('Build failed')
        console.error(output)
        reject(new Error('vite build exited with code ' + code))
      }
    })
  })
}

export function verifyBuildOutput(
  cwd: string,
  manifest?: { background?: { main?: string } },
) {
  const distDir = path.join(cwd, 'dist')

  // Dual-entry layout (Tier 2 worker/view split): dist/view.html is the
  // user-facing iframe; dist/worker.html is additionally required when
  // the manifest declares background.main (always-on headless worker).
  const hasView = fs.existsSync(path.join(distDir, 'view.html'))
  const hasWorker = fs.existsSync(path.join(distDir, 'worker.html'))
  const requiresWorker = !!manifest?.background?.main

  // Legacy single-entry layouts (pre-dual-entry extensions).
  const hasWebApp = fs.existsSync(path.join(distDir, 'index.html'))
  const hasLibrary = fs.existsSync(path.join(distDir, 'index.js'))

  const hasDualEntry = hasView && (!requiresWorker || hasWorker)
  const hasLegacy = hasWebApp || hasLibrary

  if (!hasDualEntry && !hasLegacy) {
    if (requiresWorker && hasView && !hasWorker) {
      console.log(chalk.red(
        '✗ Build output incomplete: manifest declares background.main but dist/worker.html is missing. ' +
        'Ensure vite.config.ts rollupOptions.input includes worker.html.'
      ))
    } else {
      console.log(chalk.red(
        '✗ Build output not found: expected dist/view.html (dual-entry) ' +
        'or dist/index.html (legacy web app) or dist/index.js (legacy library)'
      ))
    }
    process.exit(1)
  }

  console.log('\nOutput:')
  if (hasDualEntry) {
    printFileSize(cwd, path.join(distDir, 'view.html'))
    if (hasWorker) printFileSize(cwd, path.join(distDir, 'worker.html'))
    for (const file of fs.readdirSync(distDir)) {
      if (file === 'view.html' || file === 'worker.html') continue
      const full = path.join(distDir, file)
      const stat = fs.statSync(full)
      if (stat.isDirectory()) {
        if (file === 'assets') {
          for (const asset of fs.readdirSync(full)) {
            printFileSize(cwd, path.join(full, asset))
          }
        }
      } else {
        printFileSize(cwd, full)
      }
    }
  } else if (hasWebApp) {
    printFileSize(cwd, path.join(distDir, 'index.html'))
    const assetsDir = path.join(distDir, 'assets')
    if (fs.existsSync(assetsDir)) {
      for (const file of fs.readdirSync(assetsDir)) {
        printFileSize(cwd, path.join(assetsDir, file))
      }
    }
  } else {
    // Library build — list all files in dist/
    for (const file of fs.readdirSync(distDir)) {
      printFileSize(cwd, path.join(distDir, file))
    }
  }

  console.log()
}

function printFileSize(cwd: string, filePath: string) {
  if (!fs.existsSync(filePath)) return
  const size = fs.statSync(filePath).size
  const label = path.relative(cwd, filePath).padEnd(42)
  const sizeStr = size > 1024
    ? `${(size / 1024).toFixed(1)} kB`
    : `${size} B`
  console.log(`  ${label} ${chalk.gray(sizeStr)}`)
}
