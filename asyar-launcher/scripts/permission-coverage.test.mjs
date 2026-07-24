import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Coverage gate for the extension permission model.
//
// The Rust gate (`check_extension_permission`) fails CLOSED: a call type that
// is neither gated (`get_required_permission`) nor on the public allowlist
// (`is_public_call`) is DENIED. That is only safe if the two lists together
// cover every call an extension can actually make — otherwise a real feature
// silently breaks. Conversely, before the gate failed closed, a privileged
// call nobody mapped was silently ALLOWED (the runs:*/tools:* fail-open bug).
//
// This test is the thing that makes the classification self-defending: it
// enumerates every `.invoke('service:action')` an extension can emit through
// the SDK and asserts each one is classified in permissions.rs. Add a new SDK
// proxy method without classifying its call type and CI turns red here — the
// developer can no longer forget.

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const SDK_SRC = resolve(REPO_ROOT, 'asyar-sdk', 'src');
const PERMISSIONS_RS = resolve(__dirname, '..', 'src-tauri', 'src', 'permissions.rs');

function walkTs(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

// Every extension→host call the SDK can make. Each proxy calls
// `broker.invoke('service:action')`; the MessageBroker prepends `asyar:api:`.
// (Verified: the SDK uses only static string literals here — no dynamically
// built call types — so this static scan is complete.)
function sdkCallTypes() {
  const re = /\.invoke\(\s*['"`]([a-zA-Z]+:[a-zA-Z]+)['"`]/g;
  const set = new Set();
  for (const file of walkTs(SDK_SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(re)) set.add(`asyar:api:${m[1]}`);
  }
  return set;
}

// Every call type the Rust gate classifies: the union of the gated map
// (`get_required_permission`) and the public allowlist (`is_public_call`).
// Parsed from those two function bodies ONLY, never the #[cfg(test)] module,
// so test fixtures can't accidentally "classify" a call.
function rustClassifiedCallTypes() {
  const src = readFileSync(PERMISSIONS_RS, 'utf8');
  const gated = src.match(
    /fn get_required_permission\(call_type: &str\) -> Option<&'static str> \{[\s\S]*?\n\}/,
  );
  const publicFn = src.match(/fn is_public_call\(call_type: &str\) -> bool \{[\s\S]*?\n\}/);
  if (!gated) throw new Error('could not find get_required_permission in permissions.rs');
  if (!publicFn) throw new Error('could not find is_public_call in permissions.rs');
  const literal = /"(asyar:api:[a-zA-Z]+:[a-zA-Z]+)"/g;
  const set = new Set();
  for (const body of [gated[0], publicFn[0]]) {
    for (const m of body.matchAll(literal)) set.add(m[1]);
  }
  return set;
}

describe('extension permission gate coverage', () => {
  it('classifies every call type an extension can invoke (fail-closed gate must be exhaustive)', () => {
    const classified = rustClassifiedCallTypes();
    const unclassified = [...sdkCallTypes()].filter((c) => !classified.has(c)).sort();
    expect(
      unclassified,
      'These SDK call types reach check_extension_permission but are in neither ' +
        'get_required_permission nor is_public_call, so the fail-closed gate would DENY them. ' +
        'Classify each in asyar-launcher/src-tauri/src/permissions.rs:\n  ' +
        unclassified.join('\n  '),
    ).toEqual([]);
  });

  it('finds a non-trivial number of SDK call types (guards against a broken scan)', () => {
    // If the extraction regex silently stops matching, the coverage check above
    // would pass vacuously. Anchor it to a sane floor.
    expect(sdkCallTypes().size).toBeGreaterThan(30);
  });
});
