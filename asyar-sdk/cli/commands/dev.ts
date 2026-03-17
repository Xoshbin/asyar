import { Command } from 'commander'
import chalk from 'chalk'
import chokidar from 'chokidar'
import * as path from 'path'
import * as fs from 'fs'
import { readManifest, validateManifest } from '../lib/manifest'
import { getExtensionsDir } from '../lib/platform'
import { runViteBuild } from './build'
import { symlinkOrCopy } from './link'

export function registerDev(program: Command) {
  program
    .command('dev')
    .description('Watch mode — auto-rebuild and auto-link on every save')
    .action(async () => {
      const cwd       = process.cwd()
      const manifest  = readManifest(cwd)
      const targetDir = path.join(getExtensionsDir(), manifest.id)

      const errors = validateManifest(manifest, cwd)
      if (errors.length > 0) {
        console.log(chalk.yellow('⚠ Validation warnings (dev mode continues):'))
        errors.forEach((e) =>
          console.log(chalk.yellow(`  ⚠ ${e.field}: ${e.message}`))
        )
      }

      console.log(chalk.cyan(`\nDev mode — ${manifest.name}`))
      console.log(chalk.gray(`Output → ${targetDir}`))
      console.log(chalk.gray('Watching src/ for changes...\n'))

      await runViteBuild(cwd)

      const isAlreadyLinked = fs.existsSync(targetDir) &&
        fs.lstatSync(targetDir).isSymbolicLink()

      if (!isAlreadyLinked) {
        await symlinkOrCopy(cwd, targetDir)
      }

      const watcher = chokidar.watch(path.join(cwd, 'src'), {
        ignoreInitial: true,
      })

      watcher.on('change', async (filePath) => {
        console.log(chalk.gray(`Changed: ${path.relative(cwd, filePath)}`))
        try {
          await runViteBuild(cwd)
          // No copy needed if symlinked — Asyar reads directly from the build output
          console.log(chalk.green('✓') + ' Rebuilt — changes are live')
        } catch {
          console.log(chalk.red('✗ Build failed'))
        }
      })
    })
}
