import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { readManifest, validateManifest } from '../lib/manifest'
import { requireAuth, logout, getOrPromptGitHubToken } from '../lib/auth'
import { GitHubClient } from '../lib/github'
import { StoreClient } from '../lib/store'
import { packageExtension } from '../lib/zip'
import { runViteBuild, verifyBuildOutput } from './build'

export function registerPublish(program: Command) {
  program
    .command('publish')
    .description('Package, release to GitHub, and submit to Asyar Store')
    .option('--dry-run',    'Run all steps but do not publish anything')
    .option('--reset-auth', 'Clear stored credentials and re-authenticate')
    .action(async (opts) => {
      const cwd = process.cwd()

      if (opts.resetAuth) {
        await logout()
        console.log(chalk.green('✓ Credentials cleared'))
      }

      // 1. Validate
      const manifest = readManifest(cwd)
      const errors   = validateManifest(manifest, cwd)
      if (errors.length > 0) {
        console.log(chalk.red('✗ Validation failed:'))
        errors.forEach((e) => console.log(chalk.red(`  ✗ ${e.field}: ${e.message}`)))
        process.exit(1)
      }
      console.log(chalk.green('✓ Validation passed'))

      // 2. Build
      try {
        await runViteBuild(cwd)
        verifyBuildOutput(cwd)
      } catch {
        process.exit(1)
      }

      // 3. Authenticate with store (GitHub OAuth)
      const { storeToken, githubUsername } = await requireAuth()
      console.log(chalk.green('✓') + ` Authenticated as ${githubUsername}`)

      // 4. Get GitHub Personal Access Token (for creating releases)
      const githubToken = await getOrPromptGitHubToken()
      const github      = new GitHubClient(githubToken)

      // 5. Resolve repo from git remote
      let repoUrl: string
      try {
        const remote = execSync('git remote get-url origin', { cwd })
          .toString().trim()
        repoUrl = remote
          .replace('git@github.com:', 'https://github.com/')
          .replace(/\.git$/, '')
      } catch {
        console.error(chalk.red('✗ Could not read git remote. Is this a git repo?'))
        process.exit(1)
      }

      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/)
      if (!repoMatch) {
        console.error(chalk.red('✗ Remote is not a GitHub URL: ' + repoUrl))
        process.exit(1)
      }
      const [, owner, repo] = repoMatch

      // 6. Check version not already released
      const releaseTag      = `v${manifest.version}`
      const existingRelease = await github.getRelease(owner, repo, releaseTag)
      if (existingRelease) {
        console.error(chalk.red(`✗ ${releaseTag} already exists on GitHub.`))
        console.error(chalk.gray('  Bump the version in manifest.json and try again.'))
        process.exit(1)
      }

      // 7. Package
      const pkgSpinner = ora('Packaging extension...').start()
      const { zipPath, checksum, sizeBytes } = packageExtension(
        cwd,
        manifest.id,
        manifest.version
      )
      pkgSpinner.succeed(
        `Extension packaged (${(sizeBytes / 1024).toFixed(1)} kB)`
      )

      if (opts.dryRun) {
        console.log(chalk.yellow('\n[Dry Run] Would publish:'))
        console.log(chalk.gray(`  Repo:     ${repoUrl}`))
        console.log(chalk.gray(`  Tag:      ${releaseTag}`))
        console.log(chalk.gray(`  Checksum: ${checksum}`))
        console.log(chalk.gray(`  Zip:      ${zipPath}`))
        console.log(chalk.yellow('\nDry run complete — nothing was published.'))
        return
      }

      // 8. Create GitHub Release
      const releaseSpinner = ora('Creating GitHub Release...').start()
      const releaseBody    = [
        manifest.description,
        '',
        '## Commands',
        ...manifest.commands.map((c) => `- **${c.name}**: ${c.description}`),
        '',
        '_Published via Asyar CLI_',
      ].join('\n')

      const release = await github.createRelease(owner, repo, {
        tag:  releaseTag,
        name: `${manifest.name} ${releaseTag}`,
        body: releaseBody,
      })
      releaseSpinner.succeed(`GitHub Release created: ${releaseTag}`)

      // 9. Upload zip asset
      const uploadSpinner = ora('Uploading package to GitHub Release...').start()
      const zipBuffer     = fs.readFileSync(zipPath)
      const asset         = await github.uploadReleaseAsset(
        release.upload_url,
        zipBuffer,
        `${manifest.id}-${manifest.version}.zip`
      )
      uploadSpinner.succeed('Package uploaded')
      fs.unlinkSync(zipPath)

      // 10. Notify Asyar Store
      const storeSpinner = ora('Submitting to Asyar Store...').start()
      const store        = new StoreClient(storeToken)
      const submission   = await store.submitExtension({
        repoUrl,
        extensionId: manifest.id,
        version:     manifest.version,
        releaseTag,
        downloadUrl: asset.browser_download_url,
        checksum,
      })
      storeSpinner.succeed('Submitted to Asyar Store')

      // Final summary
      console.log(chalk.green('\n✓ Published successfully!\n'))
      console.log(`  ${chalk.bold('Extension:')}  ${manifest.name} v${manifest.version}`)
      console.log(`  ${chalk.bold('GitHub:')}     ${release.html_url}`)
      console.log(`  ${chalk.bold('Status:')}     Pending review`)
      console.log(`  ${chalk.bold('Track:')}      ${submission.trackingUrl}`)
      console.log(
        chalk.gray('\nYour extension will appear in the store once approved.')
      )
    })
}
