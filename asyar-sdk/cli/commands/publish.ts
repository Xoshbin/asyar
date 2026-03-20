import { Command } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { readManifest, validateManifest } from '../lib/manifest'
import { requireAuth, logout, login, getOrAuthorizeGitHub } from '../lib/auth'
import { GitHubClient } from '../lib/github'
import { StoreClient, AuthExpiredError, SubmitResult } from '../lib/store'
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
              // 422 means repo already exists — try to use it
              if (err.message?.includes('422')) {
                createSpinner.warn(`Repository "${repoName}" already exists — using it`)
                try {
                  const existingRepo = await github.getRepo(githubUsername, repoName)
                  newRepo = {
                    html_url:  existingRepo.html_url,
                    clone_url: existingRepo.clone_url,
                    ssh_url:   existingRepo.ssh_url,
                  }
                } catch {
                  createSpinner.fail(`Repository "${repoName}" exists but is not accessible`)
                  console.error(chalk.gray(
                    `  Use --repo https://github.com/${githubUsername}/${repoName} to specify it explicitly`
                  ))
                  process.exit(1)
                }
              } else {
                createSpinner.fail('Failed to create repository')
                console.error(chalk.red('✗ ' + err.message))
                process.exit(1)
              }
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
                try {
                  execSync('git push -u origin master', { cwd, stdio: 'pipe' })
                } catch {
                  // Both branch names failed — try force push on main
                  execSync('git push -u origin main --force', { cwd, stdio: 'pipe' })
                }
              }
              pushSpinner.succeed('Pushed to GitHub')
            } catch (err: any) {
              pushSpinner.fail('Failed to push to GitHub')
              console.error(chalk.red('✗ ' + err.message))
              console.error(chalk.gray(
                `  Repo was created at ${repoUrl}\n` +
                `  Push manually with: git push -u origin main --force\n` +
                `  Then run "asyar publish" again.`
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

      let downloadUrl: string
      let releaseHtmlUrl: string

      if (existingRelease) {
        // Find existing zip asset
        const existingAsset = existingRelease.assets?.find(
          (a: any) => a.name.endsWith('.zip')
        )

        if (existingAsset) {
          // Release and asset both exist — fully completed in previous run
          console.log(
            chalk.yellow(`⚠ Release ${releaseTag} already exists — resuming from store submission`)
          )
          downloadUrl    = existingAsset.browser_download_url
          releaseHtmlUrl = existingRelease.html_url
        } else {
          // Release exists but asset missing — upload asset only
          const uploadSpinner = ora('Uploading missing asset to existing release...').start()
          const zipBuffer     = fs.readFileSync(zipPath)
          const asset         = await github.uploadReleaseAsset(
            existingRelease.upload_url,
            zipBuffer,
            `${manifest.id}-${manifest.version}.zip`
          )
          uploadSpinner.succeed('Asset uploaded to existing release')
          downloadUrl    = asset.browser_download_url
          releaseHtmlUrl = existingRelease.html_url
        }
      } else {
        // Fresh publish — create release and upload asset
        const releaseBody = [
          manifest.description,
          '',
          '## Commands',
          ...manifest.commands.map((c) => `- **${c.name}**: ${c.description}`),
          '',
          '_Published via Asyar CLI_',
        ].join('\n')

        const releaseSpinner = ora('Creating GitHub Release...').start()
        const release        = await github.createRelease(owner, repo, {
          tag:  releaseTag,
          name: `${manifest.name} ${releaseTag}`,
          body: releaseBody,
        })
        releaseSpinner.succeed(`GitHub Release created: ${releaseTag}`)

        const uploadSpinner = ora('Uploading package...').start()
        const zipBuffer     = fs.readFileSync(zipPath)
        const asset         = await github.uploadReleaseAsset(
          release.upload_url,
          zipBuffer,
          `${manifest.id}-${manifest.version}.zip`
        )
        uploadSpinner.succeed('Package uploaded')
        downloadUrl    = asset.browser_download_url
        releaseHtmlUrl = release.html_url
      }

      // Clean up temp zip
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath)

      // 10. Notify Asyar Store
      const storeSpinner = ora('Submitting to Asyar Store...').start()
      let store = new StoreClient(storeToken)

      let submission: SubmitResult
      try {
        submission = await store.submitExtension({
          repoUrl,
          extensionId: manifest.id,
          version: manifest.version,
          releaseTag,
          downloadUrl,
          checksum,
        })
      } catch (err) {
        if (err instanceof AuthExpiredError) {
          storeSpinner.warn('Store session expired — re-authenticating...')
          await logout()
          const { storeToken: freshToken } = await login()
          
          storeSpinner.start('Retrying store submission...')
          store = new StoreClient(freshToken)
          submission = await store.submitExtension({
            repoUrl,
            extensionId: manifest.id,
            version: manifest.version,
            releaseTag,
            downloadUrl,
            checksum,
          })
        } else {
          storeSpinner.fail('Store submission failed')
          throw err
        }
      }
      
      storeSpinner.succeed('Store submission complete')

      // Handle each result state
      if (submission.status === 'already_pending') {
        console.log(chalk.yellow('\n⚠ Already submitted and pending review'))
        if (submission.trackingUrl) {
          console.log(chalk.gray(`  Track: ${submission.trackingUrl}`))
        }
        console.log(chalk.gray('  No action needed — your extension is in the review queue.'))
        process.exit(0)
      }

      if (submission.status === 'already_approved') {
        console.log(chalk.yellow('\n⚠ This version is already approved in the store'))
        console.log(chalk.gray('  Bump the version in manifest.json to publish an update.'))
        process.exit(0)
      }

      // Fresh submission — show full success output
      console.log(chalk.green('\n✓ Published successfully!\n'))
      console.log(`  ${chalk.bold('Extension:')}  ${manifest.name} v${manifest.version}`)
      console.log(`  ${chalk.bold('GitHub:')}     ${releaseHtmlUrl}`)
      console.log(`  ${chalk.bold('Status:')}     Pending review`)
      console.log(`  ${chalk.bold('Track:')}      ${submission.trackingUrl}`)
      console.log(chalk.gray('\nYour extension will appear in the store once approved.'))
    })
}
