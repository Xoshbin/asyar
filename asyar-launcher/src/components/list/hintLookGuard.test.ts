// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';

/**
 * Every hint in the launcher wears one look (design-language skill, "Hints").
 * It is defined once, in LauncherListRow, and reached through
 * `variant: 'hint'`. A second definition would let hints drift apart again, so
 * this fails when the hint selectors appear anywhere else.
 */
const SRC = resolve(__dirname, '../..');
const OWNER = 'components/list/LauncherListRow.svelte';

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(svelte|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('hint look', () => {
  it('is styled only by LauncherListRow', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => relative(SRC, file) !== OWNER)
      .filter((file) => /\.hint-(row|chip)\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('is actually defined in LauncherListRow', () => {
    const owner = readFileSync(join(SRC, OWNER), 'utf8');
    expect(owner).toMatch(/\.hint-row/);
    expect(owner).toMatch(/\.hint-chip/);
  });
});
