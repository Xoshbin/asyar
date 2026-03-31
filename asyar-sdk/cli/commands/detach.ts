import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import chalk from 'chalk'
import { readManifest } from '../lib/manifest'
import { getDevExtensionsFile } from '../lib/platform'

export function registerDetach(program: Command) {
  program
    .command('detach [id-or-path]')
    .description('Unregister a dev extension from the launcher')
    .option('--all', 'Remove all dev extension registrations')
    .action((idOrPath: string | undefined, opts: any) => {
      try {
        const devExtensionsFile = getDevExtensionsFile()
        if (!fs.existsSync(devExtensionsFile)) {
          console.log(chalk.yellow('No dev extensions registered.'))
          return
        }

        let registry: Record<string, string> = JSON.parse(fs.readFileSync(devExtensionsFile, 'utf-8'))

        if (opts.all) {
          const count = Object.keys(registry).length
          fs.writeFileSync(devExtensionsFile, JSON.stringify({}, null, 2))
          console.log(chalk.green('✓') + ` Detached ${count} extension(s).`)
          return
        }

        let identifier = idOrPath
        if (!identifier) {
          try {
            const manifest = readManifest(process.cwd())
            identifier = manifest.id
          } catch {
            console.log(chalk.red('Provide an extension ID, path, or run from inside an extension directory.'))
            return
          }
        }

        let removedId: string | undefined
        if (identifier.includes('/') || identifier.includes('\\')) {
          // It's a path
          const fullPath = path.resolve(identifier)
          for (const [id, dir] of Object.entries(registry)) {
            if (path.resolve(dir) === fullPath) {
              removedId = id
              delete registry[id]
              break
            }
          }
        } else {
          // It's an ID
          if (registry[identifier]) {
            removedId = identifier
            delete registry[identifier]
          }
        }

        if (!removedId) {
          console.log(chalk.yellow(`Extension "${identifier}" is not registered as a dev extension.`))
          return
        }

        fs.writeFileSync(devExtensionsFile, JSON.stringify(registry, null, 2))
        console.log(chalk.green('✓') + ` Detached ${removedId}`)
      } catch (error: any) {
        console.log(chalk.red('✗ ' + error.message))
        process.exit(1)
      }
    })
}
