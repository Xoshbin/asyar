import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootLayoutPath = resolve(process.cwd(), 'src/routes/+layout.svelte');
const stickyCapabilityPath = resolve(process.cwd(), 'src-tauri/capabilities/sticky.json');

describe('sticky route isolation', () => {
  it('bypasses the privileged app shell, like the HUD route', () => {
    const rootLayout = readFileSync(rootLayoutPath, 'utf8');
    // A sticky is a small standalone window; pulling in AppShell would drag the
    // whole launcher (search orchestrator, extension host) into every sticky.
    expect(rootLayout).toContain("'/sticky'");
    expect(rootLayout).toContain("import('../components/layout/AppShell.svelte')");
  });

  it('matches dynamically-labelled sticky windows and can hear app events', () => {
    const capability = JSON.parse(readFileSync(stickyCapabilityPath, 'utf8')) as {
      windows: string[];
      permissions: string[];
    };

    // Labels are `sticky-<note_id>`, so the capability must glob-match.
    expect(capability.windows).toContain('sticky-*');
    // Cross-window `notes:changed` is an app event — core:default doesn't cover it.
    expect(capability.permissions).toContain('core:event:allow-listen');
  });

  it('needs no core window permissions — window control goes through sticky_* commands', () => {
    const capability = JSON.parse(readFileSync(stickyCapabilityPath, 'utf8')) as {
      permissions: string[];
    };
    // Dragging/closing are custom commands (covered by core:default), so
    // granting core:window:* here would be privilege we don't use.
    expect(capability.permissions.filter((p) => p.startsWith('core:window:'))).toEqual([]);
  });

  it('stays content-only — no filesystem or shell access', () => {
    const capability = JSON.parse(readFileSync(stickyCapabilityPath, 'utf8')) as {
      permissions: string[];
    };
    const forbidden = capability.permissions.filter((p) => /^(fs|shell|opener):/.test(p));
    expect(forbidden).toEqual([]);
  });
});
