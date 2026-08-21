#!/usr/bin/env node
/**
 * Unified CI verification runner for Asyar Project.
 * Runs all format, design, frontend test, and Rust validation checks.
 * Exits with non-zero code on any failure.
 */
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const tauriRoot = resolve(root, 'asyar-launcher', 'src-tauri');

function runStep(name, cmd, cwd = root) {
  console.log(`\n▶ Running: ${name}...`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    console.log(`✓ ${name} passed`);
  } catch (error) {
    console.error(`\n✗ ${name} failed`);
    process.exit(1);
  }
}

console.log('=== Asyar Local CI Verification Matrix ===\n');

// 1. Workspace Prettier check
runStep('Prettier Format Check', 'pnpm format:check');

// 2. Design System check
runStep('Design System Compliance', 'pnpm check:design');

// 3. Full Workspace Frontend Tests
runStep('Workspace Frontend Tests', 'pnpm -r --if-present test:run');

// 4. Rust checks (if src-tauri exists)
if (existsSync(tauriRoot)) {
  runStep('Rust Formatting (cargo fmt)', 'cargo fmt --check', tauriRoot);
  runStep('Rust Clippy (-D warnings)', 'cargo clippy --all-targets -- -D warnings', tauriRoot);
  runStep('Rust Tests (cargo test)', 'cargo test', tauriRoot);
}

console.log('\n✨ All CI verification checks passed successfully!\n');
