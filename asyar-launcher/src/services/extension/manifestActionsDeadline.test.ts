/** @vitest-environment node */
import { readFileSync } from 'node:fs';
import { it, expect } from 'vitest';

// Manifest `actions` were removed, but published extensions that still declare
// them keep loading (the field is stripped in discovery.rs) until this deadline.
it('removes the manifest `actions` compatibility before launcher 0.2.0 ships', () => {
  const source = readFileSync(
    new URL('../../../src-tauri/src/extensions/discovery.rs', import.meta.url),
    'utf8',
  );
  const version = JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
  ).version;
  const target = source.match(/remove in (\d+)\.(\d+)\.(\d+)/);
  expect(target, 'compatibility must declare its removal target').not.toBeNull();
  const current = version.split(/[.-]/).slice(0, 3).map(Number);
  const deadline = target!.slice(1).map(Number);
  const earlier =
    current[0] < deadline[0] ||
    (current[0] === deadline[0] &&
      (current[1] < deadline[1] || (current[1] === deadline[1] && current[2] < deadline[2])));
  expect(earlier, 'remove manifest `actions` compatibility and this guard before 0.2.0').toBe(true);
});
