#!/usr/bin/env node
/**
 * Build the SDK then start the Asyar app in development mode.
 * Cross-platform (Node.js, no bash dependencies).
 */
import { execSync, spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

console.log('Building asyar-sdk once to initialize dist/...');
try {
  execSync('pnpm run build:all', {
    cwd: resolve(root, 'asyar-sdk'),
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}

console.log('Starting development mode (SDK Watch + Launcher)...');

const sdkWatch = spawn('pnpm', ['run', 'watch'], {
  cwd: resolve(root, 'asyar-sdk'),
  stdio: 'inherit',
  shell: true,
});

// --config merges tauri.dev.conf.json (JSON Merge Patch) over tauri.conf.json,
// giving the dev build its own identifier (org.asyar.dev) so it gets a fully
// separate app data dir from the installed production app — extensions,
// snippets, search index, caches, and login/auth are all isolated. The only
// thing shared by default is which backend they talk to (both point at
// asyar.org); override with ASYAR_API_BASE to test against a different one
// (see auth/api_client.rs).
const launcherDev = spawn('pnpm', ['tauri', 'dev', '--config', 'src-tauri/tauri.dev.conf.json'], {
  cwd: resolve(root, 'asyar-launcher'),
  stdio: 'inherit',
  shell: true,
});

// Ensure both exit when one stops
const cleanup = (code) => {
  sdkWatch.kill();
  launcherDev.kill();
  process.exit(code ?? 0);
};

sdkWatch.on('exit', cleanup);
launcherDev.on('exit', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
