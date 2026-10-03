#!/usr/bin/env node
/**
 * Unified CI verification runner for Asyar Project.
 * Supports smart tiered verification (--frontend, --rust, --changed, --all).
 * Exits with non-zero code on any failure.
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const tauriRoot = resolve(root, 'asyar-launcher', 'src-tauri');

function printHelp() {
  console.log(`
Usage: node scripts/check-ci.mjs [options]

Options:
  -f, --frontend    Run frontend checks (Prettier, Design System, Vitest)
  -r, --rust        Run Rust checks (cargo fmt, clippy, cargo test)
  -c, --changed     Inspect git status & diff to run only touched domains
  -a, --all         Run full CI verification matrix (default)
  -h, --help        Show this help message
`);
}

function runStep(name, cmd, cwd = root) {
  console.log(`\n▶ Running: ${name}...`);
  const startTime = Date.now();
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✓ ${name} passed (${duration}s)`);
  } catch (error) {
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.error(`\n✗ ${name} failed (${duration}s)`);
    process.exit(1);
  }
}

function getChangedFiles() {
  const files = new Set();

  // 1. Uncommitted and staged changes
  try {
    const statusOut = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    for (const line of statusOut.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const pathPart = trimmed.substring(2).trim();
      if (pathPart.includes(' -> ')) {
        const [oldPath, newPath] = pathPart.split(' -> ');
        files.add(oldPath.replace(/^"|"$/g, ''));
        files.add(newPath.replace(/^"|"$/g, ''));
      } else {
        files.add(pathPart.replace(/^"|"$/g, ''));
      }
    }
  } catch {
    // git status failed, ignore
  }

  // 2. If working tree is clean, inspect committed changes on branch
  if (files.size === 0) {
    const diffCommands = [
      'git diff --name-only @{upstream}...HEAD',
      'git diff --name-only origin/main...HEAD',
      'git diff --name-only main...HEAD',
      'git diff --name-only HEAD~1...HEAD',
    ];

    for (const cmd of diffCommands) {
      try {
        const diffOut = execSync(cmd, {
          cwd: root,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        for (const line of diffOut.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) files.add(trimmed);
        }
        if (files.size > 0) break;
      } catch {
        // try next diff command
      }
    }
  }

  return Array.from(files);
}

function isRustFile(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  return (
    norm.startsWith('asyar-launcher/src-tauri/') ||
    norm.endsWith('.rs') ||
    norm.endsWith('Cargo.toml') ||
    norm.endsWith('Cargo.lock')
  );
}

// Parse command line arguments
const args = process.argv.slice(2);
let runFrontend = false;
let runRust = false;
let checkChanged = false;
let runAll = false;

for (const arg of args) {
  if (arg === '--frontend' || arg === '-f') {
    runFrontend = true;
  } else if (arg === '--rust' || arg === '-r') {
    runRust = true;
  } else if (arg === '--changed' || arg === '-c') {
    checkChanged = true;
  } else if (arg === '--all' || arg === '-a') {
    runAll = true;
  } else if (arg === '--help' || arg === '-h') {
    printHelp();
    process.exit(0);
  } else {
    console.error(`✗ Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }
}

if (checkChanged) {
  const changedFiles = getChangedFiles();
  if (changedFiles.length === 0) {
    console.log('ℹ No changed files detected via git. Nothing to verify.');
    process.exit(0);
  }
  let hasFrontend = false;
  let hasRust = false;
  for (const file of changedFiles) {
    if (isRustFile(file)) {
      hasRust = true;
    } else {
      hasFrontend = true;
    }
  }
  runFrontend = runFrontend || hasFrontend;
  runRust = runRust || hasRust;
  console.log(`ℹ Git changes detected (${changedFiles.length} file(s)):`);
  console.log(`  - Frontend / Workspace checks: ${runFrontend ? 'YES' : 'SKIPPED'}`);
  console.log(`  - Rust checks:                 ${runRust ? 'YES' : 'SKIPPED'}\n`);
}

// Default to all checks if no specific scope flag or if --all is provided
if (runAll || (!runFrontend && !runRust)) {
  runFrontend = true;
  runRust = true;
}

const scopeLabel = runFrontend && runRust ? 'Full Matrix' : runFrontend ? 'Frontend' : 'Rust';
console.log(`=== Asyar Local CI Verification Matrix (${scopeLabel}) ===\n`);

const totalStartTime = Date.now();

// Frontend checks
if (runFrontend) {
  runStep('Prettier Format Check', 'pnpm format:check');
  runStep('Design System Compliance', 'pnpm check:design');
  runStep('Workspace CI Coverage', 'node --test scripts/workspace-ci.test.mjs');
  runStep('Workspace Frontend Tests', 'pnpm -r --if-present test:run');
}

// Rust checks
if (runRust) {
  if (existsSync(tauriRoot)) {
    runStep('Rust Formatting (cargo fmt)', 'cargo fmt --check', tauriRoot);
    runStep(
      'Rust Clippy (-D warnings)',
      'cargo clippy --workspace --all-targets -- -D warnings',
      tauriRoot,
    );
    runStep('Rust Tests (cargo test)', 'cargo test --workspace', tauriRoot);
  } else {
    console.warn('\n⚠️ asyar-launcher/src-tauri not found, skipping Rust checks.');
  }
}

const totalDuration = ((Date.now() - totalStartTime) / 1000).toFixed(1);
console.log(`\n✨ All CI verification checks passed successfully in ${totalDuration}s!\n`);
