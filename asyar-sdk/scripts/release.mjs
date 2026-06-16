#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  VERSION_KEYWORDS, computeNextVersion, makeExec,
  assertCleanTree, assertTagNotOnRemote, syncLockfile, releaseViaPr,
} from '../../scripts/release-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sdkRoot = resolve(__dirname, '..')          // asyar-sdk/
const monorepoRoot = resolve(sdkRoot, '..')        // repo root

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const input = argv.find((a) => !a.startsWith('--'))
if (!input) {
  console.error(`Usage: pnpm run release <${VERSION_KEYWORDS.join('|')}|x.y.z> [--dry-run]`)
  process.exit(1)
}

const exec = makeExec({ dryRun })
const pkgPath = resolve(sdkRoot, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

let version
try {
  version = computeNextVersion(pkg.version, input)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
const tag = `sdk-v${version}`
console.log(`SDK release: ${pkg.version} → ${version}  (tag ${tag})${dryRun ? '  [dry-run]' : ''}`)

try {
  assertCleanTree(exec, monorepoRoot)
  assertTagNotOnRemote(exec, tag, monorepoRoot)

  if (dryRun) {
    console.log(`[dry-run] would set asyar-sdk/package.json version → ${version}`)
  } else {
    pkg.version = version
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
    console.log('✓ asyar-sdk/package.json')
  }
  syncLockfile(exec, monorepoRoot)

  const prUrl = releaseViaPr(exec, {
    cwd: monorepoRoot,
    tag,
    branch: `release/${tag}`,
    files: ['asyar-sdk/package.json', 'pnpm-lock.yaml'],
    commitMessage: `chore(sdk): release ${version}`,
    prTitle: `chore(sdk): release ${version}`,
    prBody: `SDK release ${version}. Merging this completes the release; the tag already triggered npm publish.`,
  })

  if (dryRun) {
    console.log('\n[dry-run] no changes pushed.')
  } else {
    console.log(`\n✓ ${tag} pushed.${prUrl ? ` PR: ${prUrl}` : ' Open a PR manually to merge into main.'}`)
    console.log('  release-sdk.yml will build the SDK, publish to npm (idempotent), and create a GitHub Release.')
  }
} catch (e) {
  console.error(`\n✖ ${e.message}`)
  process.exit(1)
}
