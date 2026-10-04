/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';

it('removes iframe compatibility before launcher 0.2.0 ships', () => {
  const source = readFileSync(new URL('./workerHost.svelte.ts', import.meta.url), 'utf8');
  const version = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ).version;
  const target = source.match(/remove in (\d+)\.(\d+)\.(\d+)/);
  expect(target, 'fallback must declare its removal target').not.toBeNull();
  const current = version.split(/[.-]/).slice(0, 3).map(Number);
  const deadline = target!.slice(1).map(Number);
  const earlier =
    current[0] < deadline[0] ||
    (current[0] === deadline[0] &&
      (current[1] < deadline[1] || (current[1] === deadline[1] && current[2] < deadline[2])));
  expect(earlier, 'remove iframe fallback and this guard before 0.2.0').toBe(true);
});
