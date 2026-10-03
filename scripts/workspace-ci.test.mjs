import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('local and platform CI include extracted Rust crates', () => {
  for (const path of ['scripts/check-ci.mjs', '.github/workflows/test-and-lint.yml']) {
    const source = readFileSync(path, 'utf8');
    const commands = path.endsWith('.yml')
      ? [...source.matchAll(/^\s+run: (cargo (?:test|clippy)[^\n]*)/gm)].map((match) => match[1])
      : [...source.matchAll(/runStep\(\s*'[^']*',\s*'(cargo (?:test|clippy)[^']*)'/g)].map(
          (match) => match[1],
        );
    assert.ok(commands.length >= 2);
    for (const command of commands) {
      if (command.includes('export_bindings')) continue;
      assert.ok(command.includes('--workspace'), `${path}: ${command}`);
    }
  }
});

test('local and platform CI enforce launcher Svelte types', () => {
  const local = readFileSync('scripts/check-ci.mjs', 'utf8');
  const platform = readFileSync('.github/workflows/test-and-lint.yml', 'utf8');
  assert.match(local, /runStep\('Launcher Type Check', 'pnpm --dir asyar-launcher check'\)/);
  assert.match(platform, /run: pnpm --dir asyar-launcher check/);
});
