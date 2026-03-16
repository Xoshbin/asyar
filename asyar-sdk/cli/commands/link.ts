import { Command } from 'commander'
import chalk from 'chalk'
import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import { readManifest } from '../lib/manifest'
import { getExtensionsDir } from '../lib/platform'
import { runViteBuild, verifyBuildOutput } from './build'

export function registerLink(program: Command) {
  program
    .command('link')
    .description('Build and copy extension to Asyar extensions directory for testing')
    .option('--watch', 'Watch src/ for changes and re-copy automatically')
    .action(async (opts) => {
      const cwd       = process.cwd()
      const manifest  = readManifest(cwd)
      const targetDir = path.join(getExtensionsDir(), manifest.id)

      await buildAndCopy(cwd, targetDir)

      if (opts.watch) {
        console.log(chalk.cyan('\nWatching src/ for changes...'))
        const watcher = chokidar.watch(path.join(cwd, 'src'), {
          ignoreInitial: true,
        })
        watcher.on('change', async (filePath) => {
          console.log(chalk.gray(`\nChanged: ${path.relative(cwd, filePath)}`))
          await buildAndCopy(cwd, targetDir)
        })
      }
    })
}

export async function buildAndCopy(cwd: string, targetDir: string) {
  await runViteBuild(cwd)
  verifyBuildOutput(cwd)

  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true })
  }
  fs.mkdirSync(targetDir, { recursive: true })

  fs.copyFileSync(
    path.join(cwd, 'manifest.json'),
    path.join(targetDir, 'manifest.json')
  )

  copyDir(path.join(cwd, 'dist'), path.join(targetDir, 'dist'))

  console.log(chalk.green('✓') + ` Linked to: ${targetDir}`)
  console.log(chalk.gray('  Reload Asyar or trigger extension rescan to see changes.'))
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
