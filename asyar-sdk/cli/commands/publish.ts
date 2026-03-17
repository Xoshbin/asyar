import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { readManifest, validateManifest } from '../lib/manifest'
import { requireAuth, logout, getOrAuthorizeGitHub } from '../lib/auth'
import { GitHubClient } from '../lib/github'
import { StoreClient } from '../lib/store'
import { packageExtension } from '../lib/zip'
import { runViteBuild, verifyBuildOutput } from './build'
import {
  getExtensionRepoUrl,
  saveExtensionRepoUrl,
} from '../lib/config'

export function registerPublish(program: Command) {
  program
    .command('publish')
    .description('Package, release to GitHub, and submit to Asyar Store')
    .option('--dry-run', 'Run all steps but do not publish anything')
    .option('--reset-auth', 'Clear stored credentials and re-authenticate')
    .option('--repo <url>', 'GitHub repository URL (overrides auto-detection)')
    .action(async (opts) => {
      const cwd = process.cwd()

      if (opts.resetAuth) {
        await logout()
        console.log(chalk.green('✓ Credentials cleared'))
      }

      // 1. Validate
      const manifest = readManifest(cwd)
      const errors = validateManifest(manifest, cwd)
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
      const githubToken = await getOrAuthorizeGitHub()
      const github = new GitHubClient(githubToken)

      // 5. Resolve repo URL — in priority order:
      // 1. --repo flag (explicit override)
      // 2. git remote origin (already configured)
      // 3. ~/.asyar/config.json (stored from previous publish)
      // 4. Auto-create GitHub repo (first time, no remote anywhere)

      let repoUrl: string

      if (opts.repo) {
        // Explicit --repo flag — validate it's a GitHub URL, store it, use it
        if (!/github\.com\//.test(opts.repo)) {
          console.error(chalk.red('✗ --repo must be a GitHub URL'))
          process.exit(1)
        }
        repoUrl = opts.repo.replace(/\.git$/, '')
        saveExtensionRepoUrl(manifest.id, repoUrl)
        console.log(chalk.green('✓') + ` Using repo: ${repoUrl}`)

      } else {
        // Try git remote
        let remoteUrl: string | null = null
        try {
          remoteUrl = execSync('git remote get-url origin', { cwd, stdio: 'pipe' })
            .toString().trim()
            .replace('git@github.com:', 'https://github.com/')
            .replace(/\.git$/, '')
        } catch {
          // No remote — that's OK, we handle it below
        }

        if (remoteUrl && /github\.com\//.test(remoteUrl)) {
          repoUrl = remoteUrl
          saveExtensionRepoUrl(manifest.id, repoUrl)
          console.log(chalk.green('✓') + ` Using repo: ${repoUrl}`)

        } else {
          // Try stored config
          const storedRepoUrl = getExtensionRepoUrl(manifest.id)

          if (storedRepoUrl) {
            repoUrl = storedRepoUrl
            console.log(chalk.green('✓') + ` Using stored repo: ${repoUrl}`)

          } else {
            // Auto-create GitHub repo
            console.log(chalk.cyan('\nNo GitHub repository found for this extension.'))
            console.log(chalk.cyan('Creating one automatically...\n'))

            // Derive a repo name from the extension ID
            // com.xoshbin.greeting → asyar-greeting-extension
            const repoName = 'asyar-' +
              manifest.id.split('.').pop() +
              '-extension'

            const createSpinner = ora(`Creating GitHub repo: ${repoName}...`).start()

            let newRepo: { html_url: string; clone_url: string; ssh_url: string }
            try {
              newRepo = await github.createRepo({
                name: repoName,
                description: manifest.description,
                isPrivate: false,
              })
              createSpinner.succeed(`Repository created: ${newRepo.html_url}`)
            } catch (err: any) {
              createSpinner.fail('Failed to create repository')
              // Handle name conflict — repo already exists under this name
              if (err.message?.includes('422')) {
                console.error(chalk.red(
                  `✗ A repo named "${repoName}" already exists on your account.`
                ))
                console.error(chalk.gray(
                  `  Use --repo https://github.com/${githubUsername}/${repoName} ` +
                  `to use it, or rename your extension ID.`
                ))
              } else {
                console.error(chalk.red('✗ ' + err.message))
              }
              process.exit(1)
            }

            repoUrl = newRepo.html_url

            // Configure git remote and push
            const pushSpinner = ora('Configuring git remote and pushing...').start()
            try {
              // Initialize git repo if needed
              try {
                execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' })
              } catch {
                execSync('git init', { cwd, stdio: 'pipe' })
                execSync('git add .', { cwd, stdio: 'pipe' })
                execSync('git commit -m "Initial extension"', { cwd, stdio: 'pipe' })
              }

              // Add remote (use HTTPS, not SSH, for reliability)
              execSync(
                `git remote add origin ${newRepo.clone_url}`,
                { cwd, stdio: 'pipe' }
              )

              // Push
              try {
                execSync('git push -u origin main', { cwd, stdio: 'pipe' })
              } catch {
                execSync('git push -u origin master', { cwd, stdio: 'pipe' })
              }
              pushSpinner.succeed('Pushed to GitHub')
            } catch (err: any) {
              pushSpinner.fail('Failed to push to GitHub')
              console.error(chalk.red('✗ ' + err.message))
              console.error(chalk.gray(
                `  Repo was created at ${repoUrl}\n` +
                `  Push manually and run "asyar publish" again.`
              ))
              process.exit(1)
            }

            // Store for future publishes
            saveExtensionRepoUrl(manifest.id, repoUrl)
            console.log(chalk.green('✓') + ` Repo URL saved for future publishes`)
          }
        }
      }

      // At this point repoUrl is guaranteed to be set
      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/)
      if (!repoMatch) {
        console.error(chalk.red('✗ Could not parse owner/repo from: ' + repoUrl))
        process.exit(1)
      }
      const [, owner, repo] = repoMatch

      // 6. Check version not already released
      const releaseTag = `v${manifest.version}`
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
      const releaseBody = [
        manifest.description,
        '',
        '## Commands',
        ...manifest.commands.map((c) => `- **${c.name}**: ${c.description}`),
        '',
        '_Published via Asyar CLI_',
      ].join('\n')

      const release = await github.createRelease(owner, repo, {
        tag: releaseTag,
        name: `${manifest.name} ${releaseTag}`,
        body: releaseBody,
      })
      releaseSpinner.succeed(`GitHub Release created: ${releaseTag}`)

      // 9. Upload zip asset
      const uploadSpinner = ora('Uploading package to GitHub Release...').start()
      const zipBuffer = fs.readFileSync(zipPath)
      const asset = await github.uploadReleaseAsset(
        release.upload_url,
        zipBuffer,
        `${manifest.id}-${manifest.version}.zip`
      )
      uploadSpinner.succeed('Package uploaded')
      fs.unlinkSync(zipPath)

      // 10. Notify Asyar Store
      const storeSpinner = ora('Submitting to Asyar Store...').start()
      const store = new StoreClient(storeToken)
      const submission = await store.submitExtension({
        repoUrl,
        extensionId: manifest.id,
        version: manifest.version,
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
