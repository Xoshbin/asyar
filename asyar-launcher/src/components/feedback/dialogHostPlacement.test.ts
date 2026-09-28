import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(import.meta.dirname, '../..');

function source(path: string): string {
  return readFileSync(resolve(src, path), 'utf8');
}

describe('DialogHost placement', () => {
  it('is owned once by AppShell so onboarding can render queued consent', () => {
    const appShell = source('components/layout/AppShell.svelte');
    const launcherPage = source('routes/+page.svelte');
    const settingsPage = source('routes/settings/+page.svelte');

    expect(appShell).toContain("import DialogHost from '../feedback/DialogHost.svelte'");
    expect(appShell).toContain('<DialogHost />');
    expect(launcherPage).not.toContain('<DialogHost />');
    expect(settingsPage).not.toContain('<DialogHost />');
  });
});
