import { describe, it, expect } from 'vitest';
import { PERMISSION_CATALOG, describePermission } from './permissionCatalog';

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
    // Mirror of the permission strings mapped in src-tauri/src/permissions.rs
    // get_required_permission. If this fails, a permission became requirable
    // without display copy — add it to PERMISSION_CATALOG.
    const gatedPermissions = [
      'clipboard:read',
      'clipboard:write',
      'notifications:send',
      'network',
      'shell:open-url',
      'fs:read',
      'fs:write',
      'fs:watch',
      'shell:spawn',
      'entitlements:read',
      'storage:read',
      'storage:write',
      'cache:read',
      'cache:write',
      'selection:read',
      'ai:use',
      'oauth:use',
      'extension:invoke',
      'application:read',
      'window:manage',
      'preferences:read',
      'preferences:write',
      'power:inhibit',
      'process:read',
      'process:kill',
      'systemEvents:read',
      'app:frontmost-watch',
      'timers:schedule',
      'timers:cancel',
      'timers:list',
      'snippets:contribute',
      'browser:tabs.read',
      'browser:tabs.write',
      'browser:bookmarks.read',
      'browser:history.read',
      'browser:page.read',
      'browser:page.write',
      'files:search',
    ];
    for (const permission of gatedPermissions) {
      expect(describePermission(permission).known, `missing catalog entry: ${permission}`).toBe(
        true,
      );
    }
  });
});
