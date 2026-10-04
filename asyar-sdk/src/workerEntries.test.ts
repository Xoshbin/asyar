/** @vitest-environment node */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../extensions');

// `extensions/` is gitignored (a local checkout of first-party extensions), so
// a clean CI checkout has nothing to scan.
it.skipIf(!existsSync(root))(
  'ships worker entries that bootstrap without the window global',
  () => {
    const failures: string[] = [];
    for (const extension of readdirSync(root)) {
      const entry = resolve(root, extension, 'src/worker.ts');
      if (!existsSync(entry)) continue;
      const source = readFileSync(entry, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      if (/\b(?:window|document)\./.test(source)) failures.push(extension);
    }
    expect(failures).toEqual([]);
  },
);
