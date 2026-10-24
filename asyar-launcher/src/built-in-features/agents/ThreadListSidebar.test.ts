// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ThreadListSidebar from './ThreadListSidebar.svelte';
import type { ThreadDef } from './types';

describe('ThreadListSidebar', () => {
  it('renders a pin badge on pinned threads', () => {
    const threads: ThreadDef[] = [
      {
        id: 't-1',
        agentId: 'a-1',
        title: 'Pinned Thread',
        isPinned: true,
        createdAt: 1000,
        updatedAt: 1000,
      },
      {
        id: 't-2',
        agentId: 'a-1',
        title: 'Regular Thread',
        isPinned: false,
        createdAt: 2000,
        updatedAt: 2000,
      },
    ];

    render(ThreadListSidebar, {
      threads,
      known: true,
      selectedThreadId: 't-1',
      onSelectThread: vi.fn(),
    });

    expect(screen.getByText('Pinned Thread')).toBeTruthy();
    expect(screen.getByText('Regular Thread')).toBeTruthy();

    const pinEmoji = screen.getByText('📌');
    expect(pinEmoji).toBeTruthy();
    expect(pinEmoji.getAttribute('aria-label')).toBeTruthy();
  });

  it('invokes onSelectThread when clicking a thread', async () => {
    const onSelect = vi.fn();
    const threads: ThreadDef[] = [
      {
        id: 't-1',
        agentId: 'a-1',
        title: 'My Thread',
        isPinned: false,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ];

    render(ThreadListSidebar, {
      threads,
      known: true,
      selectedThreadId: null,
      onSelectThread: onSelect,
    });

    await fireEvent.click(screen.getByText('My Thread'));
    expect(onSelect).toHaveBeenCalledWith('t-1');
  });
});
