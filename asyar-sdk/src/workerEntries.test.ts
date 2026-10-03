/** @vitest-environment node */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect } from 'vitest';
it('ships worker entries that bootstrap without the window global', () => {
  const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../extensions');
  const failures: string[] = [];
  for (const extension of readdirSync(root)) {
    const entry = resolve(root, extension, 'src/worker.ts');
    if (!existsSync(entry)) continue;
    const source = readFileSync(entry, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    if (/\b(?:window|document)\./.test(source)) failures.push(extension);
  }
  expect(failures).toEqual([]);
});
