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

      if (!opts.skipValidate) {
        const manifest = readManifest(cwd)
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
        verifyBuildOutput(cwd)
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

export function verifyBuildOutput(cwd: string) {
  const distDir = path.join(cwd, 'dist')

  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log(chalk.red('✗ dist/index.html not found after build'))
    process.exit(1)
  }

  console.log('\nOutput:')
  printFileSize(cwd, path.join(distDir, 'index.html'))

  const assetsDir = path.join(distDir, 'assets')
  if (fs.existsSync(assetsDir)) {
    for (const file of fs.readdirSync(assetsDir)) {
      printFileSize(cwd, path.join(assetsDir, file))
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
