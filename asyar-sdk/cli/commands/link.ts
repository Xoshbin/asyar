import { Command } from 'commander'
import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import chokidar from 'chokidar'
import { readManifest } from '../lib/manifest'
import { getExtensionsDir } from '../lib/platform'
import { runViteBuild, verifyBuildOutput } from './build'

export function registerLink(program: Command) {
  program
    .command('link')
    .description('Link extension to Asyar extensions directory for local testing')
    .option('--watch', 'Watch src/ for changes and rebuild automatically')
    .option('--copy',  'Use file copy instead of symlink (fallback mode)')
    .action(async (opts) => {
      const cwd       = process.cwd()
      const manifest  = readManifest(cwd)
      const targetDir = path.join(getExtensionsDir(), manifest.id)

      // Build first
      await runViteBuild(cwd)
      verifyBuildOutput(cwd)

      if (opts.copy) {
        // Explicit copy mode — use old behavior
        await copyLink(cwd, targetDir)
      } else {
        // Default — try symlink, fall back to copy
        await symlinkOrCopy(cwd, targetDir)
      }

      if (opts.watch) {
        console.log(chalk.cyan('\nWatching src/ for changes...'))
        const watcher = chokidar.watch(path.join(cwd, 'src'), {
          ignoreInitial: true,
        })
        watcher.on('change', async (filePath) => {
          console.log(chalk.gray(`\nChanged: ${path.relative(cwd, filePath)}`))
          try {
            await runViteBuild(cwd)
            verifyBuildOutput(cwd)
            console.log(chalk.green('✓') + ' Rebuilt — changes are live')
          } catch {
            console.log(chalk.red('✗ Build failed — fix errors and save again'))
          }
        })
      }
    })
}

async function symlinkOrCopy(cwd: string, targetDir: string) {
  // Remove existing link or directory
  if (fs.existsSync(targetDir)) {
    const stat = fs.lstatSync(targetDir)
    if (stat.isSymbolicLink() || stat.isFIFO()) {
      fs.unlinkSync(targetDir)
    } else {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
  }

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(targetDir), { recursive: true })

  try {
    createSymlink(cwd, targetDir)
    console.log(chalk.green('✓') + ` Symlinked: ${targetDir}`)
    console.log(chalk.gray(`  → ${cwd}`))
    console.log(chalk.gray(
      '  Rebuilds are reflected immediately — no re-link needed.'
    ))
  } catch (err: any) {
    // Symlink failed — fall back to copy with explanation
    console.log(chalk.yellow(
      '⚠ Symlink failed, falling back to file copy'
    ))
    console.log(chalk.gray(`  Reason: ${err.message}`))
    await copyLink(cwd, targetDir)
  }
}

function createSymlink(target: string, linkPath: string) {
  if (process.platform === 'win32') {
    // Directory junction — no admin required on Windows
    execSync(`mklink /J "${linkPath}" "${target}"`, { stdio: 'pipe' })
  } else {
    // macOS and Linux — standard symlink
    fs.symlinkSync(target, linkPath, 'dir')
  }
}

async function copyLink(cwd: string, targetDir: string) {
  // Remove existing
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
  fs.mkdirSync(targetDir, { recursive: true })

  // Copy manifest.json
  fs.copyFileSync(
    path.join(cwd, 'manifest.json'),
    path.join(targetDir, 'manifest.json')
  )

  // Copy dist/
  copyDir(path.join(cwd, 'dist'), path.join(targetDir, 'dist'))

  console.log(chalk.green('✓') + ` Copied to: ${targetDir}`)
  console.log(chalk.gray(
    '  Run "asyar link" again after each rebuild to update.'
  ))
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(srcPath, destPath)
    else fs.copyFileSync(srcPath, destPath)
  }
}

// Export for use in dev.ts
export { copyLink, symlinkOrCopy }
