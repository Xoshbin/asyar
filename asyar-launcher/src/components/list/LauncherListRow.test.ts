// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import LauncherListRow from './LauncherListRow.svelte';
import ResultsList from './ResultsList.svelte';

describe('LauncherListRow hint variant', () => {
  it('looks like any other row by default', () => {
    const { container } = render(LauncherListRow, { title: 'Caffeinate', subtitle: 'Coffee' });
    expect(container.querySelector('.hint-row')).toBeNull();
    expect(container.querySelector('[data-test="hint-chip"]')).toBeNull();
  });

  it('marks the row so it can stand out from the commands around it', () => {
    const { container } = render(LauncherListRow, {
      title: 'Search only in Coffee',
      subtitle: '@Coffee',
      variant: 'hint',
    });
    expect(container.querySelector('button.hint-row')).not.toBeNull();
  });

  it('shows the @ token as a chip, not as plain subtitle text', () => {
    const { container } = render(LauncherListRow, {
      title: 'Search only in Coffee',
      subtitle: '@Coffee',
      variant: 'hint',
    });
    const chip = container.querySelector('[data-test="hint-chip"]');
    expect(chip?.textContent).toBe('@Coffee');
  });
});

describe('ResultsList hint row', () => {
  const base = { score: 0, action: () => {} };

  it('gives only an item that asks for the hint variant the hint look', () => {
    const { container } = render(ResultsList, {
      items: [
        { ...base, object_id: 'c1', title: 'Caffeinate', subtitle: 'Coffee', type: 'command' },
        {
          ...base,
          object_id: 'scope_hint_x',
          title: 'Search only in Coffee',
          subtitle: '@Coffee',
          type: 'scope',
          variant: 'hint',
        },
      ],
      selectedIndex: 0,
    });
    const rows = container.querySelectorAll('button.result-item');
    expect(rows).toHaveLength(2);
    expect(rows[0].classList.contains('hint-row')).toBe(false);
    expect(rows[1].classList.contains('hint-row')).toBe(true);
    expect(screen.getByText('Search only in Coffee')).toBeTruthy();
  });
});
