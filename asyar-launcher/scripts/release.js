#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

import semver from 'semver'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── Read current version ─────────────────────────────────────────────────────
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const currentVersion = pkg.version

// ── Validate argument ────────────────────────────────────────────────────────
const input = process.argv[2]
const keywords = ['patch', 'minor', 'major', 'beta']

if (!input) {
  console.error(`Usage: pnpm run release <${keywords.join('|')}|x.y.z>`)
  process.exit(1)
}

let version = input

if (keywords.includes(input)) {
  if (input === 'beta') {
    if (currentVersion.includes('-')) {
      version = semver.inc(currentVersion, 'prerelease')
    } else {
      version = semver.inc(currentVersion, 'prepatch')
    }
  } else {
    version = semver.inc(currentVersion, input)
  }
  console.log(`Calculating ${input} bump: ${currentVersion} → ${version}`)
} else {
  // Manual version input validation
  // Windows MSI (WiX) requires any pre-release identifier to be numeric-only and <= 65535.
  if (!/^\d+\.\d+\.\d+(-[0-9]+(\.[0-9]+)*)?$/.test(input)) {
    console.error(`Invalid version: "${input}"`)
    console.error('\nError: Windows compatibility requires any pre-release suffix to be numeric-only.')
    console.error('Use "0.1.0-1" instead of "0.1.0-beta".')
    process.exit(1)
  }
}

// ── Check for uncommitted changes ────────────────────────────────────────────
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim()
if (dirty) {
  console.error('Working tree is not clean. Commit or stash changes before releasing.')
  process.exit(1)
}

// ── Fetch SDK latest version ──────────────────────────────────────────────────
console.log('Fetching latest asyar-sdk version from NPM...')
let latestSdk = ''
try {
  latestSdk = execSync('npm view asyar-sdk version', { stdio: 'pipe' }).toString().trim()
  console.log(`✓ Latest SDK on NPM: ${latestSdk}`)
} catch (e) {
  console.error('Failed to fetch asyar-sdk version from NPM. Aborting.')
  process.exit(1)
}

console.log(`\nBumping Launcher version → ${version}\n`)

// ── 1. package.json ──────────────────────────────────────────────────────────
pkg.version = version
if (pkg.dependencies && pkg.dependencies['asyar-sdk']) {
  pkg.dependencies['asyar-sdk'] = `^${latestSdk}`
}
if (pkg.devDependencies && pkg.devDependencies['asyar-sdk']) {
  pkg.devDependencies['asyar-sdk'] = `^${latestSdk}`
}
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('✓ package.json')

// ── 2. Update Scaffold Fallback ─────────────────────────────────────────────
const scaffoldPath = resolve(root, 'src', 'built-in-features', 'create-extension', 'scaffoldService.ts')
let scaffoldUpdated = false
if (existsSync(scaffoldPath)) {
  let scaffold = readFileSync(scaffoldPath, 'utf8')
  const updated = scaffold.replace(/return '\^[\d.]+';(\s*\/\/ Offline fallback)?/, `return '^${latestSdk}'; // Offline fallback`)
  if (updated !== scaffold) {
    writeFileSync(scaffoldPath, updated)
    scaffoldUpdated = true
    console.log('✓ scaffoldService.ts')
  }
}

// ── 4. src-tauri/Cargo.toml ──────────────────────────────────────────────────
// Replace only the first bare `version = "..."` line — always the [package] version.
const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8')
const updatedCargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
if (updatedCargo === cargo) {
  console.error('Could not find version line in Cargo.toml — aborting')
  process.exit(1)
}
writeFileSync(cargoPath, updatedCargo)
console.log('✓ src-tauri/Cargo.toml')

// ── 5. Update Cargo.lock ─────────────────────────────────────────────────────
console.log('\nSyncing src-tauri/Cargo.lock...')
execSync('cargo update -p asyar', { cwd: resolve(root, 'src-tauri'), stdio: 'inherit' })
console.log('✓ src-tauri/Cargo.lock')

// ── 6. Update pnpm-lock.yaml ─────────────────────────────────────────────────
console.log('\nSyncing Launcher pnpm-lock.yaml...')
execSync('pnpm install', { cwd: root, stdio: 'inherit' })
console.log('✓ Launcher pnpm-lock.yaml synced')

// ── 7. Git commit + tag + push ───────────────────────────────────────────────
const tag = `v${version}`
const filesToAdd = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'pnpm-lock.yaml']
if (scaffoldUpdated) filesToAdd.push('src/built-in-features/create-extension/scaffoldService.ts')

execSync(`git add ${filesToAdd.join(' ')}`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: release ${version} & sync sdk ${latestSdk}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will now build the binary.\n`)
