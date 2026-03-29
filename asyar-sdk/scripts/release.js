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

// ── Update Independent Repositories ───────────────────────────────────────────
function updateRepo(repoPath, name, isLauncher = false) {
  if (!existsSync(repoPath)) return

  console.log(`\nChecking ${name}...`)
  
  let gitRoot = repoPath
  if (!existsSync(resolve(gitRoot, '.git'))) {
    console.warn(`⚠ Warning: ${name} does not have a .git folder. Skipping update.`)
    return
  }

  let pkgUpdated = false
  const pkgPath = resolve(repoPath, 'package.json')
  
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    
    // We expect extensions / launcher won't use 'workspace:*' if they are strictly independent,
    // but just in case, we forcefully bump it to the remote specifier for the release.
    if (pkg.dependencies && pkg.dependencies['asyar-sdk']) {
      pkg.dependencies['asyar-sdk'] = `^${version}`
      pkgUpdated = true
    }
    if (pkg.devDependencies && pkg.devDependencies['asyar-sdk']) {
      pkg.devDependencies['asyar-sdk'] = `^${version}`
      pkgUpdated = true
    }
    if (pkgUpdated) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    }
  }

  // Special scaffold file for launcher
  let scaffoldUpdated = false
  if (isLauncher) {
    const scaffoldPath = resolve(repoPath, 'src', 'built-in-features', 'create-extension', 'scaffoldService.ts')
    if (existsSync(scaffoldPath)) {
      let scaffold = readFileSync(scaffoldPath, 'utf8')
      const updated = scaffold.replace(/return '\^[\d.]+';(\s*\/\/ Offline fallback)?/, `return '^${version}'; // Offline fallback`)
      if (updated !== scaffold) {
        writeFileSync(scaffoldPath, updated)
        scaffoldUpdated = true
      }
    }
  }

  if (pkgUpdated || scaffoldUpdated) {
    try {
      console.log(`Syncing lockfile for ${name}...`)
      // Use --ignore-workspace to firmly prevent pnpm from modifying the Asyar-Project root wrapper lockfile.
      execSync('pnpm install --ignore-workspace', { cwd: gitRoot, stdio: 'inherit' })
      
      const filesToAdd = ['package.json', 'pnpm-lock.yaml']
      if (existsSync(resolve(gitRoot, 'package-lock.json'))) filesToAdd.push('package-lock.json')
      if (scaffoldUpdated) filesToAdd.push('src/built-in-features/create-extension/scaffoldService.ts')

      execSync(`git add ${filesToAdd.join(' ')}`, { cwd: gitRoot, stdio: 'inherit' })
      execSync(`git commit -m "chore(deps): update asyar-sdk to ${version}"`, { cwd: gitRoot, stdio: 'inherit' })
      execSync(`git push origin HEAD`, { cwd: gitRoot, stdio: 'inherit' })
      console.log(`✓ Committed and pushed updates to github for ${name}`)
    } catch (err) {
      console.error(`✖ Failed to commit updates for ${name}: ${err.message}`)
    }
  } else {
    console.log(`No updates needed for ${name}.`)
  }
}

// 1. Launcher
updateRepo(resolve(root, '..', 'asyar-launcher'), 'asyar-launcher', true)

// 2. Extensions (one by one)
const extensionsDir = resolve(root, '..', 'extensions')
if (existsSync(extensionsDir)) {
  const extensions = readdirSync(extensionsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
    .map(dirent => dirent.name)

  for (const ext of extensions) {
    updateRepo(resolve(extensionsDir, ext), `extensions/${ext}`, false)
  }
}

// ── Git commit + tag + push ──────────────────────────────────────────────────
console.log('Syncing lockfiles for SDK...')
execSync('pnpm install', { cwd: root, stdio: 'inherit' })

const tag = `v${version}`
execSync(`git add package.json pnpm-lock.yaml package-lock.json`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will publish to npm and create a GitHub Release.\n`)
