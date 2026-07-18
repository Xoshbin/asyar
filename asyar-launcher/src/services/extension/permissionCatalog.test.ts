import { describe, it, expect } from 'vitest';
import { PERMISSION_CATALOG, describePermission } from './permissionCatalog';
import { GATED_PERMISSIONS } from './gatedPermissions';

describe('permissionCatalog', () => {
  it('describes a known permission with catalog metadata', () => {
    const info = describePermission('fs:watch');
    expect(info.known).toBe(true);
    expect(info.title).toBe(PERMISSION_CATALOG['fs:watch'].title);
    expect(info.description.length).toBeGreaterThan(0);
  });

  it('falls back to the raw string for unknown permissions', () => {
    const info = describePermission('quantum:entangle');
    expect(info.known).toBe(false);
    expect(info.title).toBe('quantum:entangle');
  });

  it('covers every permission the Rust gate can require', () => {
    // GATED_PERMISSIONS is generated from src-tauri/src/permissions.rs
    // get_required_permission (see scripts/generate-permission-catalog.mjs)
    // so this can't silently drift from the real Rust source. If this
    // fails, a permission became requirable without display copy — add it
    // to PERMISSION_CATALOG, then run `pnpm gen:permission-catalog`.
    for (const permission of GATED_PERMISSIONS) {
      expect(describePermission(permission).known, `missing catalog entry: ${permission}`).toBe(
        true,
      );
    }
  });
});
