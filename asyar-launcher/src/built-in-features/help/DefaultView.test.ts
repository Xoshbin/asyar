/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const { scrollMock } = vi.hoisted(() => ({
  scrollMock: vi.fn(),
}));

vi.mock('../../lib/listScroll', () => ({
  scrollSelectedIntoView: (...args: unknown[]) => scrollMock(...args),
}));

import DefaultView from './DefaultView.svelte';
import { helpViewState } from './helpState.svelte';

function flushFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('Help DefaultView keyboard scroll', () => {
  beforeEach(() => {
    scrollMock.mockClear();
    helpViewState.reset();
  });

  afterEach(() => {
    helpViewState.reset();
  });

  it('marks topic rows with data-index for scroll targeting', () => {
    const { container } = render(DefaultView);
    const rows = container.querySelectorAll('.topic-row[data-index]');
    expect(rows.length).toBe(helpViewState.filtered.length);
    expect(rows[0]?.getAttribute('data-index')).toBe('0');
    if (rows.length > 1) {
      expect(rows[1]?.getAttribute('data-index')).toBe('1');
    }
  });

  it('scrolls the selected topic into view when the selection moves', async () => {
    render(DefaultView);
    await tick();
    await flushFrame();
    scrollMock.mockClear();

    helpViewState.move(1);
    await tick();
    await flushFrame();

    expect(scrollMock).toHaveBeenCalled();
    const lastCall = scrollMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toBe(1);
    expect(lastCall?.[0]).toBeInstanceOf(HTMLElement);
  });
});
