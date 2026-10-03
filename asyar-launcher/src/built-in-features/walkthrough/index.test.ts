/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('../../services/walkthrough/walkthroughService.svelte', () => ({
  walkthroughService: {
    refresh: vi.fn().mockResolvedValue(undefined),
    shouldShowInRoot: true,
    progress: { completed: 2, total: 5 },
    complete: vi.fn().mockResolvedValue(undefined),
    uncomplete: vi.fn().mockResolvedValue(undefined),
    completeAll: vi.fn().mockResolvedValue(undefined),
    setDismissed: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    dismissed: false,
  },
}));

vi.mock('./walkthroughViewState.svelte', () => ({
  walkthroughViewState: {
    reset: vi.fn(),
    setSearch: vi.fn().mockResolvedValue(undefined),
    mode: 'list',
    move: vi.fn(),
    open: vi.fn(),
    back: vi.fn().mockReturnValue(false),
    openTask: null,
    selected: { id: 't1', completed: false, source: 'manual' },
  },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));

import { actionService } from '../../services/action/actionService.svelte';
import { walkthroughService } from '../../services/walkthrough/walkthroughService.svelte';
import walkthroughExtension from './index';
import { walkthroughViewState } from './walkthroughViewState.svelte';

function makeContext(manager: object) {
  return {
    getService: <T>(_name: string): T => manager as unknown as T,
  };
}

describe('WalkthroughExtension commands and root search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executeCommand("show-walkthrough") navigates to walkthrough/DefaultView and refreshes service', async () => {
    const navigateToView = vi.fn();
    const ctx = makeContext({ navigateToView });
    await walkthroughExtension.initialize(ctx as never);

    const result = await walkthroughExtension.executeCommand('show-walkthrough');
    expect(walkthroughViewState.reset).toHaveBeenCalled();
    expect(walkthroughService.refresh).toHaveBeenCalled();
    expect(navigateToView).toHaveBeenCalledWith('walkthrough/DefaultView');
    expect(result).toEqual({ type: 'view', viewPath: 'walkthrough/DefaultView' });
  });

  it('search("") returns progress row when shouldShowInRoot is true', async () => {
    const results = await walkthroughExtension.searchRows('');
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Beyond the basics');
    expect(results[0].subtitle).toBe('2 of 5 tasks — learn what Asyar can really do');
  });

  it('search("something") returns empty array', async () => {
    const results = await walkthroughExtension.searchRows('query');
    expect(results).toHaveLength(0);
  });
});

describe('WalkthroughExtension lifecycle: viewActivated, viewDeactivated, activate, deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'addEventListener');
    vi.spyOn(window, 'removeEventListener');
  });

  it('viewActivated sets action label, registers actions, and attaches keydown listener', async () => {
    const setActiveViewActionLabel = vi.fn();
    const ctx = makeContext({ setActiveViewActionLabel });
    await walkthroughExtension.initialize(ctx as never);

    await walkthroughExtension.viewActivated('walkthrough/DefaultView');

    expect(window.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(setActiveViewActionLabel).toHaveBeenCalledWith('Open Task');
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'walkthrough:mark-complete' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'walkthrough:mark-all-complete' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'walkthrough:dismiss' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'walkthrough:reset' }),
    );
  });

  it('viewDeactivated removes keydown listener, clears label, and unregisters actions', async () => {
    const setActiveViewActionLabel = vi.fn();
    const ctx = makeContext({ setActiveViewActionLabel });
    await walkthroughExtension.initialize(ctx as never);

    await walkthroughExtension.viewActivated('walkthrough/DefaultView');
    await walkthroughExtension.viewDeactivated('walkthrough/DefaultView');

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(setActiveViewActionLabel).toHaveBeenCalledWith(null);
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:mark-complete');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:mark-all-complete');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:dismiss');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:reset');
  });

  it('activate() refreshes walkthrough service', async () => {
    await walkthroughExtension.activate();
    expect(walkthroughService.refresh).toHaveBeenCalledTimes(1);
  });

  it('deactivate() cleans up keydown listener, clears action label, unregisters actions, and resets state', async () => {
    const setActiveViewActionLabel = vi.fn();
    const ctx = makeContext({ setActiveViewActionLabel });
    await walkthroughExtension.initialize(ctx as never);

    await walkthroughExtension.viewActivated('walkthrough/DefaultView');
    await walkthroughExtension.deactivate();

    expect(window.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    expect(setActiveViewActionLabel).toHaveBeenCalledWith(null);
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:mark-complete');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:mark-all-complete');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:dismiss');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:reset');
    expect(walkthroughViewState.reset).toHaveBeenCalled();
  });

  it('deactivate() is safe and idempotent when not in view', async () => {
    await walkthroughExtension.deactivate();
    expect(actionService.unregisterAction).toHaveBeenCalledWith('walkthrough:mark-complete');
    expect(walkthroughViewState.reset).toHaveBeenCalled();
  });
});

it('registers walkthrough as a typed platform search provider', async () => {
  const { searchBuiltinProviders } = await import('../../services/search/builtinSearchProviders');
  const search = vi.spyOn(walkthroughExtension, 'searchRows').mockResolvedValueOnce([]);
  const rows = await searchBuiltinProviders('', (id) => id === 'walkthrough');
  expect(search).toHaveBeenCalled();
  search.mockRestore();
  expect(rows.every((row) => typeof (row as any).action !== 'function')).toBe(true);
});
