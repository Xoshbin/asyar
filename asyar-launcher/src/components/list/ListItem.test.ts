// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const { appearance } = vi.hoisted(() => ({
  appearance: { listDensity: 'comfortable' } as Record<string, unknown>,
}));

vi.mock('../../services/settings/settingsService.svelte', () => ({
  settingsService: { currentSettings: { appearance } },
}));

import ListItem from './ListItem.svelte';

describe('ListItem density', () => {
  it('takes row height, gap, title size and two-line mode from the setting', () => {
    const { container } = render(ListItem, { title: 'Nord', subtitle: 'Theme' });
    const row = container.querySelector('.list-row') as HTMLElement;
    expect(row.getAttribute('style')).toContain('--row-h: 48px');
    expect(row.getAttribute('style')).toContain('--row-gap: 12px');
    expect(row.getAttribute('style')).toContain('--row-title: 14px');
    expect(row.classList.contains('two-line')).toBe(true);
  });

  it('keeps the subtitle on the title line when two-line is off', () => {
    appearance.listDensity = 'dense';
    const { container } = render(ListItem, { title: 'Nord', subtitle: 'Theme' });
    const row = container.querySelector('.list-row') as HTMLElement;
    expect(row.getAttribute('style')).toContain('--row-h: 36px');
    expect(row.classList.contains('two-line')).toBe(false);
  });
});
