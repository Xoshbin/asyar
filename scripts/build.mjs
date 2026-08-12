#!/usr/bin/env node
/**
 * Full clean production build.
 * 1. Clean previous Tauri build output
 * 2. Build asyar-sdk (types + CLI)
 * 3. Run pnpm tauri build (Rust + frontend → native binary)
 *
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync, execFileSync } from 'child_process';
import { rmSync, existsSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const launcherDir = resolve(root, 'asyar-launcher');
const extBuilderDir = resolve(root, 'asyar-ext-builder');
const requestedBuildArgs = process.argv.slice(2);
const buildArgs = requestedBuildArgs[0] === '--' ? requestedBuildArgs.slice(1) : requestedBuildArgs;
const isLocalBuild = buildArgs.length === 1 && buildArgs[0] === '--local';

if (buildArgs.length > 0 && !isLocalBuild) {
  console.error('Usage: pnpm build [--local]');
  process.exit(64);
}

function run(cmd, cwd = root) {
  execSync(cmd, { cwd, stdio: 'inherit' });
}

/**
 * Resolve a usable `bun` executable: prefer one on PATH, otherwise fall back
 * to a bun binary manually placed under src-tauri/binaries/bun-<triple> for
 * local dev (see src-tauri/binaries/README.md) — bun is no longer bundled at
 * build time.
 */
function resolveBun() {
  try {
    execSync('bun --version', { stdio: 'ignore' });
    return 'bun';
  } catch {
    // fall through to a manually-placed local dev binary
  }
  const binariesDir = resolve(launcherDir, 'src-tauri', 'binaries');
  if (existsSync(binariesDir)) {
    const match = readdirSync(binariesDir).find((f) => f.startsWith('bun-') && !f.endsWith('.sig'));
    if (match) return join(binariesDir, match);
  }
  return null;
}

function step(msg) {
  console.log(`\n── ${msg} ${'─'.repeat(Math.max(0, 60 - msg.length))}`);
}

// 1. Clean
step('Cleaning previous build output');

const toClean = [
  resolve(launcherDir, 'src-tauri', 'target', 'release', 'bundle'),
  resolve(launcherDir, '.svelte-kit', 'output'),
  resolve(launcherDir, '.vite'),
];
for (const dir of toClean) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    console.log(`  removed ${dir.replace(root + '/', '')}`);
  }
}

// 2. Build SDK
step('Building asyar-sdk');
try {
  run('pnpm run build:all', resolve(root, 'asyar-sdk'));
  console.log('✓ SDK built');
} catch {
  console.error('✗ SDK build failed');
  process.exit(1);
}

// 3. Build the AI ext-builder sidecar JS (dist/sidecar.js) so build.rs stages a
//    real bundle instead of an empty placeholder. Without this the AI extension
//    builder ships non-functional.
step('Building ext-builder sidecar JS (build:js)');
const bun = resolveBun();
if (!bun) {
  console.error(
    '✗ No bun found (not on PATH and no local bun-<triple> binary in src-tauri/binaries). ' +
      'Install bun (https://bun.sh) or place one manually — see src-tauri/binaries/README.md.',
  );
  process.exit(1);
}
try {
  execFileSync(bun, ['install'], { cwd: extBuilderDir, stdio: 'inherit' });
  execFileSync(bun, ['run', 'build:js'], { cwd: extBuilderDir, stdio: 'inherit' });
  console.log('✓ ext-builder sidecar JS built');
} catch {
  console.error('✗ ext-builder sidecar build failed');
  process.exit(1);
}

// 4. Tauri build (Rust + frontend)
step('Building asyar-launcher (pnpm tauri build)');
try {
  // Local benchmark builds use the isolated dev bundle ID and keychain entry,
  // but retain release optimizations and skip updater artifacts/signing.
  const buildCommand = isLocalBuild
    ? 'ASYAR_KEYCHAIN_SERVICE=org.asyar.dev pnpm tauri build --config src-tauri/tauri.dev.conf.json --config \'{"bundle":{"createUpdaterArtifacts":false}}\''
    : 'pnpm tauri build';
  run(buildCommand, launcherDir);
  console.log('\n✓ Build complete');
} catch {
  console.error('✗ Tauri build failed');
  process.exit(1);
}
