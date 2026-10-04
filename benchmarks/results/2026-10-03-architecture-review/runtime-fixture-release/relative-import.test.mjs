import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

test('packaged daemon loads a separate relative module', () => {
  const worker = readFileSync(new URL('./dist/daemon/main.js', import.meta.url), 'utf8');
  assert.match(worker, /from ["']\.\/relative\.js["']/);
  assert.match(readFileSync(new URL('./dist/daemon/relative.js', import.meta.url), 'utf8'), /42/);
});
