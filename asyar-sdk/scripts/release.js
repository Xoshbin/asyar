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
    version = semver.inc(currentVersion, 'prerelease', '1')
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

// ── Update SDK version in asyar extension template (if monorepo) ─────────────
const asyarTemplatePath = resolve(root, '..', 'asyar-launcher', 'src', 'built-in-features',
  'create-extension', 'template', 'package.json.tmpl')
if (existsSync(asyarTemplatePath)) {
  // ── Update asyar-launcher dependency ─────────────────────────────────────────
  const launcherPkgPath = resolve(root, '..', 'asyar-launcher', 'package.json')
  if (existsSync(launcherPkgPath)) {
    const launcherPkg = JSON.parse(readFileSync(launcherPkgPath, 'utf8'))
    if (launcherPkg.dependencies && launcherPkg.dependencies['asyar-sdk']) {
      launcherPkg.dependencies['asyar-sdk'] = `^${version}`
      writeFileSync(launcherPkgPath, JSON.stringify(launcherPkg, null, 2) + '\n')
      console.log('✓ Updated asyar-sdk dependency in asyar-launcher/package.json')
    }
  }

  // ── Update extensions dependencies ───────────────────────────────────────────
  const extensionsDir = resolve(root, '..', 'extensions')
  if (existsSync(extensionsDir)) {
    const extensions = readdirSync(extensionsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)

    for (const ext of extensions) {
      const extPkgPath = resolve(extensionsDir, ext, 'package.json')
      if (existsSync(extPkgPath)) {
        const extPkg = JSON.parse(readFileSync(extPkgPath, 'utf8'))
        let updated = false
        if (extPkg.dependencies && extPkg.dependencies['asyar-sdk'] && extPkg.dependencies['asyar-sdk'] !== 'workspace:*') {
          extPkg.dependencies['asyar-sdk'] = `^${version}`
          updated = true
        }
        if (extPkg.devDependencies && extPkg.devDependencies['asyar-sdk'] && extPkg.devDependencies['asyar-sdk'] !== 'workspace:*') {
          extPkg.devDependencies['asyar-sdk'] = `^${version}`
          updated = true
        }
        if (updated) {
          writeFileSync(extPkgPath, JSON.stringify(extPkg, null, 2) + '\n')
          console.log(`✓ Updated asyar-sdk dependency in extensions/${ext}/package.json`)
        }
      }
    }
  }

  // Note: the template now uses {{SDK_VERSION}} which is resolved dynamically at
  // scaffold time via npm. This step updates the offline fallback default in
  // scaffoldService.ts so it stays current.
  const scaffoldPath = resolve(root, '..', 'asyar-launcher', 'src', 'built-in-features',
    'create-extension', 'scaffoldService.ts')
  if (existsSync(scaffoldPath)) {
    let scaffold = readFileSync(scaffoldPath, 'utf8')
    const updated = scaffold.replace(
      /return '\^[\d.]+';(\s*\/\/ Offline fallback)?/,
      `return '^${version}'; // Offline fallback`
    )
    if (updated !== scaffold) {
      writeFileSync(scaffoldPath, updated)
      console.log('✓ Updated offline fallback SDK version in scaffoldService.ts')
    }
  }
} else {
  console.log('⚠ asyar repo not found as sibling — remember to update the SDK version fallback in the extension template')
}

// ── Git commit + tag + push ──────────────────────────────────────────────────
const tag = `v${version}`
execSync(`git add package.json`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will publish to npm and create a GitHub Release.\n`)
