import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(currentDir, '../..');

async function readSource(relativePath: string) {
  return readFile(resolve(srcRoot, relativePath), 'utf8');
}

function cssRule(source: string, selector: string) {
  const start = source.indexOf(selector);
  expect(start).toBeGreaterThanOrEqual(0);

  const openingBrace = source.indexOf('{', start);
  const closingBrace = source.indexOf('\n  }', openingBrace);
  expect(openingBrace).toBeGreaterThan(start);
  expect(closingBrace).toBeGreaterThan(openingBrace);

  return source.slice(openingBrace + 1, closingBrace);
}

describe('shared control surface defaults', () => {
  it('keeps default buttons visible inside SettingsCard surfaces', async () => {
    const css = await readSource('resources/styles/style.css');

    expect(cssRule(css, '  .btn {')).toContain('background-color: var(--bg-secondary);');
  });

  it('keeps default badges visible inside SettingsCard surfaces', async () => {
    const source = await readSource('components/base/Badge.svelte');

    expect(source).toContain('background-color: var(--bg-secondary);');
  });

  it('keeps default selects visible inside SettingsCard surfaces', async () => {
    const source = await readSource('components/base/Select.svelte');

    expect(source).toContain('background-color: var(--bg-secondary);');
  });
});
