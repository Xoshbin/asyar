#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  VERSION_KEYWORDS, computeNextVersion, makeExec,
  assertCleanTree, assertTagNotOnRemote, syncLockfile, releaseViaPr,
} from '../../scripts/release-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')              // asyar-launcher/
const monorepoRoot = resolve(root, '..')           // repo root

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const input = argv.find((a) => !a.startsWith('--'))
if (!input) {
  console.error(`Usage: pnpm run release <${VERSION_KEYWORDS.join('|')}|x.y.z> [--dry-run]`)
  process.exit(1)
}

const exec = makeExec({ dryRun })

const pkgPath = resolve(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

let version
try {
  version = computeNextVersion(pkg.version, input)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
const tag = `v${version}`

// Single source of truth for the SDK version: the local SDK package.json.
// (No `npm view` — the workspace override means the launcher always builds the
//  local SDK, and src-tauri/build.rs already injects ASYAR_SDK_VERSION from it.)
const sdkVersion = JSON.parse(
  readFileSync(resolve(monorepoRoot, 'asyar-sdk', 'package.json'), 'utf8'),
).version
console.log(`Launcher release: ${pkg.version} → ${version} (tag ${tag}) · local SDK ${sdkVersion}${dryRun ? '  [dry-run]' : ''}`)

try {
  assertCleanTree(exec, root)
  assertTagNotOnRemote(exec, tag, root)

  const filesToAdd = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', '../pnpm-lock.yaml']

  if (dryRun) {
    console.log(`[dry-run] would bump package.json → ${version}, pin asyar-sdk → ^${sdkVersion}`)
    console.log('[dry-run] would update scaffoldService.ts offline fallback, Cargo.toml, Cargo.lock')
  } else {
    // 1. package.json: version + declared SDK dep
    pkg.version = version
    if (pkg.dependencies?.['asyar-sdk']) pkg.dependencies['asyar-sdk'] = `^${sdkVersion}`
    if (pkg.devDependencies?.['asyar-sdk']) pkg.devDependencies['asyar-sdk'] = `^${sdkVersion}`
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log('✓ package.json')

    // 2. scaffoldService.ts offline fallback (live regex target)
    const scaffoldPath = resolve(root, 'src', 'built-in-features', 'create-extension', 'scaffoldService.ts')
    if (existsSync(scaffoldPath)) {
      const before = readFileSync(scaffoldPath, 'utf8')
      const after = before.replace(/return '\^[\d.]+';(\s*\/\/ Offline fallback)?/, `return '^${sdkVersion}'; // Offline fallback`)
      if (after !== before) {
        writeFileSync(scaffoldPath, after)
        filesToAdd.push('src/built-in-features/create-extension/scaffoldService.ts')
        console.log('✓ scaffoldService.ts')
      }
    }

    // NOTE: discovery.rs / SUPPORTED_SDK_VERSION is handled at compile time by
    // src-tauri/build.rs (reads node_modules/asyar-sdk/package.json). No patch here.

    // 3. Cargo.toml [package] version (first bare version line only)
    const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
    const cargo = readFileSync(cargoPath, 'utf8')
    const updatedCargo = cargo.replace(/^version = ".*"$/m, `version = "${version}"`)
    if (updatedCargo === cargo) {
      console.error('Could not find version line in Cargo.toml — aborting')
      process.exit(1)
    }
    writeFileSync(cargoPath, updatedCargo)
    console.log('✓ src-tauri/Cargo.toml')

    // 4. Cargo.lock
    exec.run('cargo update -p asyar', resolve(root, 'src-tauri'))
    console.log('✓ src-tauri/Cargo.lock')
  }

  syncLockfile(exec, monorepoRoot)

  const prUrl = releaseViaPr(exec, {
    cwd: root,
    tag,
    branch: `release/${tag}`,
    files: filesToAdd,
    commitMessage: `chore: release ${version}`,
    prTitle: `chore: release ${version}`,
    prBody: `Launcher release ${version} (SDK ${sdkVersion}). The tag already triggered the build; merge to land the bump on main.`,
  })

  if (dryRun) {
    console.log('\n[dry-run] no changes pushed.')
  } else {
    console.log(`\n✓ ${tag} pushed.${prUrl ? ` PR: ${prUrl}` : ' Open a PR manually.'}`)
    console.log('  release-launcher.yml will build all 6 targets, publish, and notify asyar.org.')
  }
} catch (e) {
  console.error(`\n✖ ${e.message}`)
  process.exit(1)
}
