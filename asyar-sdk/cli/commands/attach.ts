import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import chalk from 'chalk'
import { readManifest } from '../lib/manifest'
import { getDevExtensionsFile } from '../lib/platform'
import { runViteBuild, verifyBuildOutput } from './build'

export function registerAttach(program: Command) {
  program
    .command('attach [path]')
    .description('Register an extension directory for dev loading in the launcher')
    .option('--all', 'Scan [path] for subdirectories containing manifest.json and attach each one')
    .option('--no-build', 'Skip building the extension(s)')
    .action(async (targetPathArg: string | undefined, opts: any) => {
      try {
        const targetPath = path.resolve(targetPathArg || process.cwd())
        let extensionDirs: string[] = []

        if (opts.all) {
          const subdirs = fs.readdirSync(targetPath, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => path.join(targetPath, dirent.name))

          extensionDirs = subdirs.filter((dir) => fs.existsSync(path.join(dir, 'manifest.json')))

          if (extensionDirs.length === 0) {
            console.log(chalk.red('✗ No extensions with manifest.json found in ' + targetPath))
            return
          }
        } else {
          if (!fs.existsSync(path.join(targetPath, 'manifest.json'))) {
            throw new Error(`manifest.json not found in ${targetPath}`)
          }
          extensionDirs = [targetPath]
        }

        const devExtensionsFile = getDevExtensionsFile()
        const devExtensionsDir = path.dirname(devExtensionsFile)

        if (!fs.existsSync(devExtensionsDir)) {
          fs.mkdirSync(devExtensionsDir, { recursive: true })
        }

        let registry: Record<string, string> = {}
        if (fs.existsSync(devExtensionsFile)) {
          try {
            registry = JSON.parse(fs.readFileSync(devExtensionsFile, 'utf-8'))
          } catch {
            registry = {}
          }
        }

        for (const dir of extensionDirs) {
          const manifest = readManifest(dir)

          if (opts.build !== false) {
            await runViteBuild(dir)
            verifyBuildOutput(dir, manifest)
          }

          registry[manifest.id] = dir
          console.log(chalk.green('✓') + ` Attached ${manifest.name} (${manifest.id})`)
        }

        fs.writeFileSync(devExtensionsFile, JSON.stringify(registry, null, 2))
        console.log(chalk.cyan(`\n${extensionDirs.length} extension(s) attached. Restart the launcher to load them.`))
      } catch (error: any) {
        console.log(chalk.red('✗ ' + error.message))
        process.exit(1)
      }
    })
}
