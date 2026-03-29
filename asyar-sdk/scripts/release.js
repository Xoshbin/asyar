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

// ── Update Workspace Dependencies ────────────────────────────────────────────
const workspaceRoots = [
  { name: 'asyar-launcher', path: resolve(root, '..', 'asyar-launcher') },
  { name: 'extensions', path: resolve(root, '..', 'extensions') }
]

for (const ws of workspaceRoots) {
  if (!existsSync(ws.path)) continue

  console.log(`Checking ${ws.name}...`)
  
  // Find the closest git root for this folder
  let gitRoot = ws.path
  if (!existsSync(resolve(gitRoot, '.git'))) {
    gitRoot = resolve(root, '..') // Fall back to parent repo
  }

  // Check if dirty in the relevant git root before touching
  try {
    const status = execSync('git status --porcelain', { cwd: gitRoot }).toString().trim()
    if (status) {
      console.warn(`⚠ Warning: ${gitRoot} has uncommitted changes. Proceeding with caution...`)
    }
  } catch (err) {
    console.error(`✖ Git not found or failed in ${gitRoot}: ${err.message}`)
    continue
  }

  let updatedFiles = []

  // 1. Update package.json in the workspace root
  const wsPkgPath = resolve(ws.path, 'package.json')
  if (existsSync(wsPkgPath)) {
    const wsPkg = JSON.parse(readFileSync(wsPkgPath, 'utf8'))
    let pkgUpdated = false
    if (wsPkg.dependencies && wsPkg.dependencies['asyar-sdk']) {
      wsPkg.dependencies['asyar-sdk'] = `^${version}`
      pkgUpdated = true
    }
    if (wsPkg.devDependencies && wsPkg.devDependencies['asyar-sdk']) {
      wsPkg.devDependencies['asyar-sdk'] = `^${version}`
      pkgUpdated = true
    }
    if (pkgUpdated) {
      writeFileSync(wsPkgPath, JSON.stringify(wsPkg, null, 2) + '\n')
      // File path relative to the gitRoot
      updatedFiles.push(wsPkgPath.replace(gitRoot + '/', ''))
    }
  }

  // 2. Special case for Launcher: scaffoldService.ts
  if (ws.name === 'asyar-launcher') {
    const scaffoldPath = resolve(ws.path, 'src', 'built-in-features', 'create-extension', 'scaffoldService.ts')
    if (existsSync(scaffoldPath)) {
      let scaffold = readFileSync(scaffoldPath, 'utf8')
      const updated = scaffold.replace(/return '\^[\d.]+';(\s*\/\/ Offline fallback)?/, `return '^${version}'; // Offline fallback`)
      if (updated !== scaffold) {
        writeFileSync(scaffoldPath, updated)
        updatedFiles.push(scaffoldPath.replace(gitRoot + '/', ''))
      }
    }
  }

  // 3. Special case for Extensions: check sub-folders
  if (ws.name === 'extensions') {
    const extensions = readdirSync(ws.path, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map(dirent => dirent.name)

    for (const ext of extensions) {
      const extPkgPath = resolve(ws.path, ext, 'package.json')
      if (existsSync(extPkgPath)) {
        const extPkg = JSON.parse(readFileSync(extPkgPath, 'utf8'))
        let extUpdated = false
        if (extPkg.dependencies && extPkg.dependencies['asyar-sdk'] && extPkg.dependencies['asyar-sdk'] !== 'workspace:*') {
          extPkg.dependencies['asyar-sdk'] = `^${version}`
          extUpdated = true
        }
        if (extPkg.devDependencies && extPkg.devDependencies['asyar-sdk'] && extPkg.devDependencies['asyar-sdk'] !== 'workspace:*') {
          extPkg.devDependencies['asyar-sdk'] = `^${version}`
          extUpdated = true
        }
        if (extUpdated) {
          writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + '\n')
          updatedFiles.push(extPkgPath.replace(gitRoot + '/', ''))
        }
      }
    }
  }

  if (updatedFiles.length > 0) {
    console.log(`✓ Updated ${ws.name}: ${updatedFiles.join(', ')}`)
    try {
      // Sync lockfile if one exists in the ws path OR the git root
      if (existsSync(resolve(ws.path, 'pnpm-lock.yaml'))) {
        console.log(`Syncing lockfile in ${ws.path}...`)
        execSync('pnpm install', { cwd: ws.path, stdio: 'inherit' })
        updatedFiles.push(resolve(ws.path, 'pnpm-lock.yaml').replace(gitRoot + '/', ''))
      } else if (existsSync(resolve(gitRoot, 'pnpm-lock.yaml'))) {
        console.log(`Syncing lockfile in ${gitRoot}...`)
        execSync('pnpm install', { cwd: gitRoot, stdio: 'inherit' })
        updatedFiles.push('pnpm-lock.yaml')
      }
      
      execSync(`git add ${updatedFiles.join(' ')}`, { cwd: gitRoot, stdio: 'inherit' })
      execSync(`git commit -m "chore(deps): update asyar-sdk to ${version}"`, { cwd: gitRoot, stdio: 'inherit' })
      execSync(`git push origin HEAD`, { cwd: gitRoot, stdio: 'inherit' })
      console.log(`✓ Committed and pushed updates to github for ${ws.name}`)
    } catch (err) {
      console.error(`✖ Failed to commit updates for ${ws.name}: ${err.message}`)
    }
  }
}

// ── Git commit + tag + push ──────────────────────────────────────────────────
const tag = `v${version}`
execSync(`git add package.json`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will publish to npm and create a GitHub Release.\n`)
