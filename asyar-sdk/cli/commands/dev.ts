import { Command } from 'commander'
import chalk from 'chalk'
import chokidar from 'chokidar'
import * as path from 'path'
import { readManifest, validateManifest } from '../lib/manifest'
import { getExtensionsDir } from '../lib/platform'
import { runViteBuild } from './build'
import { buildAndCopy } from './link'  // reuse the copy logic

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

      const watcher = chokidar.watch(path.join(cwd, 'src'), {
        ignoreInitial: true,
      })

      watcher.on('change', async (filePath) => {
        console.log(chalk.gray(`Changed: ${path.relative(cwd, filePath)}`))
        try {
          await buildAndCopy(cwd, targetDir)
        } catch {
          console.log(chalk.red('✗ Build failed — fix errors and save again'))
        }
      })
    })
}
