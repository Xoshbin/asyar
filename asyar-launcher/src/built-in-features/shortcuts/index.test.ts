/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./shortcutStore.svelte', () => ({
  shortcutStore: {
    isCapturing: false,
  },
}));

vi.mock('./shortcutViewState.svelte', () => ({
  shortcutViewState: {
    moveSelection: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));

import shortcutsExtension from './index';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';

describe('ShortcutsExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtensionManager = {
      navigateToView: vi.fn(),
    };
  });

  it('navigates to DefaultView on open-shortcuts command', async () => {
    await shortcutsExtension.initialize({
      getService: () => mockExtensionManager,
      preferences: { values: {} },
    } as any);

    const res = await shortcutsExtension.executeCommand('open-shortcuts');
    expect(res).toEqual({ type: 'view', viewPath: 'shortcuts/DefaultView' });
    expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('shortcuts/DefaultView');
  });

  it('handles keydown navigation when active in view', async () => {
    await shortcutsExtension.viewActivated('shortcuts/DefaultView');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(shortcutViewState.moveSelection).toHaveBeenCalledWith('down');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(shortcutViewState.moveSelection).toHaveBeenCalledWith('up');

    await shortcutsExtension.viewDeactivated('shortcuts/DefaultView');
    expect(shortcutViewState.reset).toHaveBeenCalled();
  });

  it('ignores keydown when isCapturing is true', async () => {
    await shortcutsExtension.viewActivated('shortcuts/DefaultView');
    (shortcutStore as any).isCapturing = true;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(shortcutViewState.moveSelection).not.toHaveBeenCalled();

    (shortcutStore as any).isCapturing = false;
    await shortcutsExtension.viewDeactivated('shortcuts/DefaultView');
  });

  it('cleans up listeners and resets view state on deactivate', async () => {
    await shortcutsExtension.viewActivated('shortcuts/DefaultView');
    await shortcutsExtension.deactivate();

    expect(shortcutViewState.reset).toHaveBeenCalled();

    // After deactivate, keydown should no longer trigger selection moves
    vi.clearAllMocks();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(shortcutViewState.moveSelection).not.toHaveBeenCalled();
  });

  it('resets state on activate', async () => {
    await shortcutsExtension.activate();
    expect(shortcutViewState.reset).toHaveBeenCalled();
  });
});
