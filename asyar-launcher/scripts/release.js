#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
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

console.log(`\nBumping version → ${version}\n`)

// ── 1. package.json ──────────────────────────────────────────────────────────
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('✓ package.json')

// ── 2. src-tauri/Cargo.toml ──────────────────────────────────────────────────
// Replace only the first bare `version = "..."` line — always the [package] version.
// Dependency entries use inline table syntax, never a bare `version = "..."` line.
const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8')
const updatedCargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
if (updatedCargo === cargo) {
  console.error('Could not find version line in Cargo.toml — aborting')
  process.exit(1)
}
writeFileSync(cargoPath, updatedCargo)
console.log('✓ src-tauri/Cargo.toml')

// ── 3. Update Cargo.lock ─────────────────────────────────────────────────────
console.log('Syncing src-tauri/Cargo.lock...')
execSync('cargo update -p asyar', { cwd: resolve(root, 'src-tauri'), stdio: 'inherit' })
console.log('✓ src-tauri/Cargo.lock')

// ── Git commit + tag + push ──────────────────────────────────────────────────
const tag = `v${version}`
execSync(`git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will now build the binary.\n`)
