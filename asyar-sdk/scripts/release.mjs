#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VERSION_KEYWORDS,
  computeNextVersion,
  makeExec,
  assertCleanTree,
  assertTagNotOnRemote,
  syncLockfile,
  releaseViaPr,
} from '../../scripts/release-lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sdkRoot = resolve(__dirname, '..'); // asyar-sdk/
const monorepoRoot = resolve(sdkRoot, '..'); // repo root

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const input = argv.find((a) => !a.startsWith('--'));
if (!input) {
  console.error(`Usage: pnpm run release <${VERSION_KEYWORDS.join('|')}|x.y.z> [--dry-run]`);
  process.exit(1);
}

const exec = makeExec({ dryRun });
const pkgPath = resolve(sdkRoot, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

let version;
try {
  version = computeNextVersion(pkg.version, input);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const tag = `sdk-v${version}`;
console.log(`SDK release: ${pkg.version} → ${version}  (tag ${tag})${dryRun ? '  [dry-run]' : ''}`);

try {
  assertCleanTree(exec, monorepoRoot);
  assertTagNotOnRemote(exec, tag, monorepoRoot);

  // The launcher asserts that its SUPPORTED_SDK_VERSION equals the SDK version
  // in the workspace (envService.test.ts), so bumping the SDK alone turns main
  // red until a launcher release happens to resync it. Carry the constant in
  // the same commit instead; the launcher's own release script rewrites it
  // again from the same source of truth, so the two can't disagree.
  const envServicePath = resolve(
    monorepoRoot,
    'asyar-launcher',
    'src',
    'services',
    'envService.ts',
  );
  const files = ['asyar-sdk/package.json', 'pnpm-lock.yaml'];

  if (dryRun) {
    console.log(`[dry-run] would set asyar-sdk/package.json version → ${version}`);
    console.log(`[dry-run] would set launcher SUPPORTED_SDK_VERSION → ${version}`);
  } else {
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('✓ asyar-sdk/package.json');

    if (existsSync(envServicePath)) {
      const before = readFileSync(envServicePath, 'utf8');
      const after = before.replace(
        /export const SUPPORTED_SDK_VERSION = '[\d.]+';/,
        `export const SUPPORTED_SDK_VERSION = '${version}';`,
      );
      if (after === before) {
        throw new Error(
          'Could not find SUPPORTED_SDK_VERSION in envService.ts — the launcher ' +
            'test would fail on main. Fix the pattern before releasing.',
        );
      }
      writeFileSync(envServicePath, after);
      files.push('asyar-launcher/src/services/envService.ts');
      console.log('✓ asyar-launcher/src/services/envService.ts');
    }
  }
  syncLockfile(exec, monorepoRoot);

  const prUrl = releaseViaPr(exec, {
    cwd: monorepoRoot,
    tag,
    branch: `release/${tag}`,
    files,
    commitMessage: `chore(sdk): release ${version}`,
    prTitle: `chore(sdk): release ${version}`,
    prBody: `SDK release ${version}. Merging this completes the release; the tag already triggered npm publish.`,
  });

  if (dryRun) {
    console.log('\n[dry-run] no changes pushed.');
  } else {
    console.log(
      `\n✓ ${tag} pushed.${prUrl ? ` PR: ${prUrl}` : ' Open a PR manually to merge into main.'}`,
    );
    console.log(
      '  release-sdk.yml will build the SDK, publish to npm (idempotent), and create a GitHub Release.',
    );
  }
} catch (e) {
  console.error(`\n✖ ${e.message}`);
  process.exit(1);
}
