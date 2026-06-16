import semver from 'semver'

export const VERSION_KEYWORDS = ['patch', 'minor', 'major', 'beta']

// Windows MSI/WiX requires any pre-release identifier to be numeric-only.
const EXPLICIT_VERSION_RE = /^\d+\.\d+\.\d+(-[0-9]+(\.[0-9]+)*)?$/

export function computeNextVersion(currentVersion, input) {
  if (VERSION_KEYWORDS.includes(input)) {
    if (input === 'beta') {
      return currentVersion.includes('-')
        ? semver.inc(currentVersion, 'prerelease')
        : semver.inc(currentVersion, 'prepatch')
    }
    return semver.inc(currentVersion, input)
  }
  if (!EXPLICIT_VERSION_RE.test(input)) {
    throw new Error(
      `Invalid version: "${input}". Windows compatibility requires any ` +
        `pre-release suffix to be numeric-only (use "0.1.0-1", not "0.1.0-beta").`,
    )
  }
  return input
}

import { execSync } from 'node:child_process'

export function makeExec({ dryRun = false, log = console.log } = {}) {
  return {
    dryRun,
    run(cmd, cwd) {
      if (dryRun) { log(`[dry-run] ${cmd}`); return }
      execSync(cmd, { cwd, stdio: 'inherit' })
    },
    runQuiet(cmd, cwd) {
      if (dryRun) { log(`[dry-run] ${cmd}`); return }
      try { execSync(cmd, { cwd, stdio: 'pipe' }) } catch { /* best-effort */ }
    },
    capture(cmd, cwd) {
      return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()
    },
  }
}

export function assertCleanTree(exec, cwd) {
  if (exec.capture('git status --porcelain', cwd)) {
    throw new Error('Working tree is not clean. Commit or stash changes before releasing.')
  }
}

export function assertTagNotOnRemote(exec, tag, cwd) {
  const existing = exec.capture(`git ls-remote --tags origin refs/tags/${tag}`, cwd)
  if (existing) {
    throw new Error(
      `Tag ${tag} already exists on the remote. This version was already released. ` +
        `Bump to a higher version, or delete the tag to re-release.`,
    )
  }
}

export function releaseViaPr(exec, { cwd, tag, branch, files, commitMessage, prTitle, prBody }) {
  exec.runQuiet(`git branch -D ${branch}`, cwd)
  exec.runQuiet(`git tag -d ${tag}`, cwd)
  exec.run(`git checkout -b ${branch}`, cwd)
  exec.run(`git add ${files.join(' ')}`, cwd)
  exec.run(`git commit -m ${JSON.stringify(commitMessage)}`, cwd)
  exec.run(`git tag ${tag}`, cwd)
  exec.run(`git push origin ${branch} ${tag}`, cwd)
  let prUrl = ''
  if (!exec.dryRun) {
    try {
      prUrl = exec.capture(
        `gh pr create --base main --head ${branch} ` +
          `--title ${JSON.stringify(prTitle)} --body ${JSON.stringify(prBody)}`,
        cwd,
      )
    } catch { /* gh missing or PR exists; maintainer opens it manually */ }
  }
  exec.runQuiet('git checkout main', cwd)
  return prUrl
}

export function syncLockfile(exec, monorepoRoot) {
  exec.run('pnpm install', monorepoRoot)
}
