#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

// ── Validate argument ────────────────────────────────────────────────────────
const version = process.argv[2]
if (!version) {
  console.error('Usage: pnpm run release <version>  (e.g. pnpm run release 0.2.0)')
  process.exit(1)
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid version: "${version}" — must be X.Y.Z (no "v" prefix)`)
  process.exit(1)
}

// ── Check for uncommitted changes ────────────────────────────────────────────
const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim()
if (dirty) {
  console.error('Working tree is not clean. Commit or stash changes before releasing.')
  process.exit(1)
}

console.log(`\nBumping version → ${version}\n`)

// ── 1. package.json ──────────────────────────────────────────────────────────
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
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

// ── Git commit + tag + push ──────────────────────────────────────────────────
const tag = `v${version}`
execSync(`git add package.json src-tauri/Cargo.toml`, { cwd: root, stdio: 'inherit' })
execSync(`git commit -m "chore: bump version to ${version}"`, { cwd: root, stdio: 'inherit' })
execSync(`git tag ${tag}`, { cwd: root, stdio: 'inherit' })
execSync(`git push origin HEAD ${tag}`, { cwd: root, stdio: 'inherit' })

console.log(`\n✓ Released ${tag} — GitHub Actions will now build the binary.\n`)
