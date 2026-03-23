#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')
const { execSync } = require('child_process')

const root = resolve(__dirname, '..')

// ── Validate argument ────────────────────────────────────────────────────────
const version = process.argv[2]
if (!version) {
  console.error('Usage: pnpm run release <version>  (e.g. pnpm run release 1.0.1)')
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

// ── Update package.json ───────────────────────────────────────────────────────
const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log('✓ package.json')

// ── Update SDK version in asyar extension template (if monorepo) ─────────────
const asyarTemplatePath = resolve(root, '..', 'asyar', 'src', 'built-in-extensions',
  'create-extension', 'template', 'package.json.tmpl')
const { existsSync } = require('fs')
if (existsSync(asyarTemplatePath)) {
  // Note: the template now uses {{SDK_VERSION}} which is resolved dynamically at
  // scaffold time via npm. This step updates the offline fallback default in
  // scaffoldService.ts so it stays current.
  const scaffoldPath = resolve(root, '..', 'asyar', 'src', 'built-in-extensions',
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
