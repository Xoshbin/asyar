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

// Every extension→host call the SDK can make. A proxy reaches the gate three
// ways: `broker.invoke('service:action')`, the structural `this.invoke(...)`,
// and a captured `const invoke = this.invoke.bind(this)` inside a returned
// handle. Any of them may carry an explicit return generic (`invoke<T>(...)`).
// The pattern MUST therefore allow an optional `<...>` and match `invoke` with
// or without a leading dot — missing the generic form is exactly how the whole
// `state:*` family slipped past the gate. The first arg is always a static
// `'service:action'` literal (no dynamically built call types).
function sdkCallTypes() {
  const re = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*['"`]([a-zA-Z]+:[a-zA-Z]+)['"`]/g;
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

// Call types the SDK's ExtensionContext constructs but that are host-realm
// operations — the fail-closed gate DENIES them for sandboxed (Tier-2)
// extensions, which is correct (before #567's fail-closed change these were
// silently ALLOWED — e.g. an extension could uninstall other extensions). They
// are listed here so coverage knows they are *intentionally* unclassified
// (denied), not forgotten. Marking any of these public/gated would hand a
// sandboxed extension a privileged host API — the guards below enforce that.
const HOST_REALM_ONLY = new Set([
  'asyar:api:extensions:getAllExtensions',
  'asyar:api:extensions:getAllExtensionsWithState',
  'asyar:api:extensions:handleViewSearch',
  'asyar:api:extensions:handleViewSubmit',
  'asyar:api:extensions:init',
  'asyar:api:extensions:loadExtensions',
  'asyar:api:extensions:reloadExtensions',
  'asyar:api:extensions:searchAll',
  'asyar:api:extensions:toggleExtensionState',
  'asyar:api:extensions:uninstallExtension',
  'asyar:api:settings:get',
  'asyar:api:settings:set',
  'asyar:api:clipboard:hideWindow',
  'asyar:api:clipboard:initialize',
  'asyar:api:commands:executeCommand',
  'asyar:api:onboarding:complete',
]);

describe('extension permission gate coverage', () => {
  it('classifies every Tier-2-callable type (fail-closed gate must be exhaustive)', () => {
    const classified = rustClassifiedCallTypes();
    const unclassified = [...sdkCallTypes()]
      .filter((c) => !classified.has(c) && !HOST_REALM_ONLY.has(c))
      .sort();
    expect(
      unclassified,
      'These SDK call types reach check_extension_permission but are in neither ' +
        'get_required_permission nor is_public_call, so the fail-closed gate would DENY them. ' +
        'EITHER classify each in asyar-launcher/src-tauri/src/permissions.rs (if a sandboxed ' +
        'extension should be able to call it) OR add it to HOST_REALM_ONLY here (if it is a ' +
        'host-only op that must stay denied for extensions):\n  ' +
        unclassified.join('\n  '),
    ).toEqual([]);
  });

  it('never both classifies AND host-realm-flags a call (that would grant a privileged API)', () => {
    const classified = rustClassifiedCallTypes();
    const wronglyAllowed = [...HOST_REALM_ONLY].filter((c) => classified.has(c)).sort();
    expect(
      wronglyAllowed,
      'These are on HOST_REALM_ONLY yet ALSO classified in permissions.rs, so a sandboxed ' +
        'extension can now reach a host-only API. Remove them from is_public_call / ' +
        'get_required_permission (or from HOST_REALM_ONLY if genuinely safe):\n  ' +
        wronglyAllowed.join('\n  '),
    ).toEqual([]);
  });

  it('keeps HOST_REALM_ONLY free of stale entries (each must still be a real SDK call)', () => {
    const calls = sdkCallTypes();
    const stale = [...HOST_REALM_ONLY].filter((c) => !calls.has(c)).sort();
    expect(
      stale,
      `HOST_REALM_ONLY lists call types the SDK no longer emits:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('finds a non-trivial number of SDK call types (guards against a broken scan)', () => {
    // If the extraction regex silently stops matching, the coverage check above
    // would pass vacuously. Anchor it to a sane floor.
    expect(sdkCallTypes().size).toBeGreaterThan(30);
  });
});
