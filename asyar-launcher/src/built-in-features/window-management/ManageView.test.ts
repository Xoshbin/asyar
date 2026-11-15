/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ManageView from './ManageView.svelte';
import { windowManagementState } from './state.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { renameLayout } from './layoutLifecycle';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./layoutLifecycle', () => ({
  applyCustomLayout: vi.fn().mockResolvedValue(undefined),
  deleteLayout: vi.fn().mockResolvedValue(undefined),
  renameLayout: vi.fn().mockResolvedValue(undefined),
  syncLayoutToIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/windowManagement/windowManagementService', () => ({
  windowManagementService: {
    getWindowBounds: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 1440, height: 900 }),
  },
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: vi.fn().mockResolvedValue(undefined),
    report: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('WindowManagement ManageView', () => {
  beforeEach(() => {
    windowManagementState.customLayouts = [
      { id: 'l1', name: 'Work Grid', bounds: { x: 0, y: 0, width: 1200, height: 800 } },
    ];
    windowManagementState.setIndex(0);
  });

  afterEach(() => {
    windowManagementState.reset();
    vi.restoreAllMocks();
  });

  it('registers Mod+Shift+E rename action for selected layout', () => {
    render(ManageView);

    const renameAction = actionService
      .getAllActions()
      .find((a) => a.id === 'window-management:rename-layout');

    expect(renameAction).toBeDefined();
    expect(renameAction?.shortcut).toBe('Mod+Shift+E');
    expect(renameAction?.icon).toBe('icon:pencil');
  });

  it('opens prompt on rename action and saves new name', async () => {
    render(ManageView);

    const renameAction = actionService
      .getAllActions()
      .find((a) => a.id === 'window-management:rename-layout');

    expect(windowManagementState.renamingLayoutId).toBeNull();
    await renameAction?.execute();
    expect(windowManagementState.renamingLayoutId).toBe('l1');

    expect(actionService.activePrompt).toBeDefined();
    expect(actionService.activePrompt?.value).toBe('Work Grid');

    await actionService.activePrompt?.onsave('Coding Split');

    expect(renameLayout).toHaveBeenCalledWith('l1', 'Coding Split', undefined);
    expect(windowManagementState.renamingLayoutId).toBeNull();
  });

  it('cancels renaming when prompt is cancelled', async () => {
    render(ManageView);

    const renameAction = actionService
      .getAllActions()
      .find((a) => a.id === 'window-management:rename-layout');

    await renameAction?.execute();
    expect(windowManagementState.renamingLayoutId).toBe('l1');

    actionService.activePrompt?.oncancel?.();
    expect(windowManagementState.renamingLayoutId).toBeNull();
  });
});
