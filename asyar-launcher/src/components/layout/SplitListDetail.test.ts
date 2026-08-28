// @vitest-environment jsdom
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRawSnippet } from 'svelte';

vi.mock('../../lib/listScroll', () => ({
  scrollSelectedIntoView: vi.fn(),
  resetListScroll: vi.fn(),
}));

import { scrollSelectedIntoView, resetListScroll } from '../../lib/listScroll';
import SplitListDetail from './SplitListDetail.svelte';

describe('SplitListDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const listItem = createRawSnippet((getItem: () => any) => ({
    render: () => `<div>${getItem()?.title ?? ''}</div>`,
  }));

  const detail = createRawSnippet(() => ({
    render: () => `<div>Detail</div>`,
  }));

  it('calls scrollSelectedIntoView on mount when selectedIndex >= 0', async () => {
    render(SplitListDetail, {
      items: [{ id: '1', title: 'Item 1' }],
      selectedIndex: 0,
      listItem,
      detail,
    });

    await new Promise((r) => requestAnimationFrame(r));
    expect(scrollSelectedIntoView).toHaveBeenCalledWith(expect.any(HTMLElement), 0);
  });

  it('calls scrollSelectedIntoView when items change', async () => {
    const { rerender } = render(SplitListDetail, {
      items: [
        { id: '1', title: 'Item 1' },
        { id: '2', title: 'Item 2' },
      ],
      selectedIndex: 0,
      listItem,
      detail,
    });

    await new Promise((r) => requestAnimationFrame(r));
    vi.clearAllMocks();

    await rerender({
      items: [{ id: '2', title: 'Item 2' }],
      selectedIndex: 0,
      listItem,
      detail,
    });

    await new Promise((r) => requestAnimationFrame(r));
    expect(scrollSelectedIntoView).toHaveBeenCalledWith(expect.any(HTMLElement), 0);
  });

  it('calls resetListScroll when selectedIndex < 0', async () => {
    render(SplitListDetail, {
      items: [],
      selectedIndex: -1,
      listItem,
      detail,
    });

    await new Promise((r) => requestAnimationFrame(r));
    expect(resetListScroll).toHaveBeenCalledWith(expect.any(HTMLElement));
  });
});
