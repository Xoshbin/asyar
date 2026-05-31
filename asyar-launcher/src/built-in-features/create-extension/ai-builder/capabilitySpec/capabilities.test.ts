import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import capabilities from './capabilities.json';

// An Asyar extension may declare a permission only if the manifest validator
// accepts it. The authoritative declarable set is the union of two sources:
//
//   1. GET_REQUIRED_PERMISSIONS — the Rust IPC gate. Every entry is a
//      permission a sensitive Tauri command checks at the wire boundary.
//      Source: src-tauri/src/permissions.rs get_required_permission()
//
//   2. LAUNCHER_GATED_PERMISSIONS — permissions accepted by the CLI validator
//      and/or gated by the launcher (JS permissionGate.ts) but NOT in the Rust
//      IPC gate above. e.g. tools:register lets an extension expose AI tools;
//      without it the feasibility gate would wrongly reject every tool-exposing
//      extension. store:read/store:write are inert legacy slugs the validator
//      still accepts (no gate, no SDK service behind them).
//      Source: asyar-sdk/cli/lib/manifest.ts VALID_PERMISSIONS (master list the
//      CLI validator enforces — it REJECTS any slug not present there) and
//      asyar-launcher/src/services/permissionGate.ts PERMISSION_MAP.
//
// Their union is exactly the master VALID_PERMISSIONS list (40 entries) — the
// definitive set of permissions an extension may legally declare in manifest.json.
const GET_REQUIRED_PERMISSIONS = [
  'ai:use', 'app:frontmost-watch', 'application:read',
  'browser:bookmarks.read', 'browser:history.read', 'browser:page.read',
  'browser:page.write', 'browser:tabs.read', 'browser:tabs.write',
  'cache:read', 'cache:write', 'clipboard:read', 'clipboard:write',
  'entitlements:read', 'extension:invoke', 'fs:read', 'fs:watch', 'fs:write',
  'network', 'notifications:send', 'oauth:use', 'power:inhibit',
  'preferences:read', 'preferences:write', 'selection:read', 'shell:open-url',
  'shell:spawn', 'snippets:contribute', 'storage:read', 'storage:write',
  'systemEvents:read', 'timers:cancel', 'timers:list', 'timers:schedule',
  'window:manage',
];

const LAUNCHER_GATED_PERMISSIONS = [
  'diagnostics:report', 'runs:track', 'store:read', 'store:write',
  'tools:register',
];

const VALID_PERMISSIONS = [
  ...new Set([...GET_REQUIRED_PERMISSIONS, ...LAUNCHER_GATED_PERMISSIONS]),
];

describe('capabilities.json sync guard', () => {
  it('lists only permissions an extension may legally declare', () => {
    for (const p of capabilities.permissions) {
      expect(VALID_PERMISSIONS).toContain(p);
    }
  });

  it('covers every declarable permission (no capability silently missing)', () => {
    for (const p of VALID_PERMISSIONS) {
      expect(capabilities.permissions).toContain(p);
    }
  });

  it('only allows the eight valid preference types', () => {
    const valid = ['textfield', 'password', 'number', 'checkbox', 'dropdown', 'appPicker', 'file', 'directory'];
    expect(capabilities.preferenceTypes.sort()).toEqual([...valid].sort());
  });

  it('ships a non-empty authoring guide alongside the JSON', () => {
    const md = readFileSync(resolve(__dirname, 'asyar-authoring.md'), 'utf-8');
    expect(md).toContain('textfield');
    expect(md).toContain('tools:register');
    expect(md.length).toBeGreaterThan(200);
  });
});
