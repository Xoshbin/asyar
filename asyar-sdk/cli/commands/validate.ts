import { Command } from 'commander'
import chalk from 'chalk'
import { readManifest, validateManifest } from '../lib/manifest'

export function registerValidate(program: Command) {
  program
    .command('validate')
    .description('Validate manifest.json and project structure')
    .action(async () => {
      const cwd = process.cwd()
      try {
        const manifest = readManifest(cwd)
        console.log(chalk.green('✓') + ' manifest.json found and parsed')

        const errors  = validateManifest(manifest, cwd)
        const fields  = ['id', 'name', 'version', 'description', 'author']

        for (const field of fields) {
          const fieldErrors = errors.filter((e) => e.field === field)
          const value       = (manifest as any)[field]
          if (fieldErrors.length === 0) {
            console.log(chalk.green('✓') + ` ${field}: ${value}`)
          } else {
            fieldErrors.forEach((e) =>
              console.log(chalk.red('✗') + ` ${e.field}: ${e.message}`)
            )
          }
        }

        errors
          .filter((e) => !fields.includes(e.field))
          .forEach((e) =>
            console.log(chalk.red('✗') + ` ${e.field}: ${e.message}`)
          )

        if (errors.length === 0) {
          console.log(chalk.green('\n✓ All checks passed'))
          process.exit(0)
        } else {
          console.log(
            chalk.red(
              `\n${errors.length} error${errors.length > 1 ? 's' : ''} found. ` +
              `Fix them and run "asyar validate" again.`
            )
          )
          process.exit(1)
        }
      } catch (err: any) {
        console.error(chalk.red('✗ ' + err.message))
        process.exit(1)
      }
    })
}
