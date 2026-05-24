#!/usr/bin/env node
const { readFileSync, writeFileSync, existsSync, readdirSync } = require('fs')
const { resolve } = require('path')
const { execSync } = require('child_process')

const root = resolve(__dirname, '..')

// ── Validate argument ────────────────────────────────────────────────────────
const versionInput = process.argv[2]
if (!versionInput) {
  console.error('Usage: pnpm run release <version|patch|minor|major>  (e.g. pnpm run release patch)')
  process.exit(1)
}

let version = versionInput
const keywords = ['patch', 'minor', 'major', 'beta']
const isKeyword = keywords.includes(versionInput)

if (!isKeyword && !/^\d+\.\d+\.\d+(-[0-9]+(\.[0-9]+)*)?$/.test(versionInput)) {
  console.error(`Invalid version: "${versionInput}"`)
  console.error('\nError: Windows compatibility (required by Asyar-Launcher) requires any pre-release suffix to be numeric-only.')
  console.error('Use "0.1.0-1" instead of "0.1.0-beta".')
  process.exit(1)
}

// If it's a keyword, we need to calculate the next version
if (isKeyword) {
  const pkgPath = resolve(root, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const currentVersion = pkg.version
  const semver = require('semver')
  
  if (versionInput === 'beta') {
    if (currentVersion.includes('-')) {
      version = semver.inc(currentVersion, 'prerelease')
    } else {
      version = semver.inc(currentVersion, 'prepatch')
    }
  } else {
    version = semver.inc(currentVersion, versionInput)
  }
  
  console.log(`Calculating ${versionInput} bump from ${currentVersion} → ${version}`)
}

// ── Check for uncommitted changes ────────────────────────────────────────────
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim()
if (dirty) {
  console.error('Working tree is not clean. Commit or stash changes before releasing.')
  process.exit(1)
}

console.log(`\nBumping version → ${version}\n`)

// ── Update package.json ───────────────────────────────────────────────────────
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('✓ package.json')

// ── Sync the workspace lockfile (at the monorepo root) ───────────────────────
const monorepoRoot = resolve(root, '..')
console.log('Syncing workspace lockfile (pnpm install)...')
execSync('pnpm install', { cwd: monorepoRoot, stdio: 'inherit' })

// ── Commit, tag (sdk-v* — distinct from launcher's v*), push ─────────────────
const tag = `sdk-v${version}`
execSync('git add asyar-sdk/package.json pnpm-lock.yaml', { cwd: monorepoRoot, stdio: 'inherit' })
execSync(`git commit -m "chore(sdk): release ${version}"`, { cwd: monorepoRoot, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: monorepoRoot, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: monorepoRoot, stdio: 'inherit' })

console.log(`\n✓ asyar-sdk ${version} pushed as tag ${tag}`)
console.log(`  GitHub Actions will now build the SDK, publish it to npm, and create a GitHub Release.\n`)
