import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootLayoutPath = resolve(process.cwd(), 'src/routes/+layout.svelte');
const hudCapabilityPath = resolve(process.cwd(), 'src-tauri/capabilities/hud.json');

describe('HUD route isolation', () => {
  it('keeps the privileged app shell out of the root layout loaded by HUD', () => {
    const rootLayout = readFileSync(rootLayoutPath, 'utf8');

    expect(rootLayout).not.toContain("from '../services/log/logService'");
    expect(rootLayout).not.toContain("from '@tauri-apps/plugin-os'");
    expect(rootLayout).toContain("import('../components/layout/AppShell.svelte')");
  });

  it('keeps native logging outside the content-only HUD capability', () => {
    const capability = JSON.parse(readFileSync(hudCapabilityPath, 'utf8')) as {
      permissions: string[];
    };

    expect(capability.permissions).not.toContain('log:default');
  });
});
