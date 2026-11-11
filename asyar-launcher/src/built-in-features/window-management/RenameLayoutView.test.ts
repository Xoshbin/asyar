/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RenameLayoutView from './RenameLayoutView.svelte';
import { windowManagementState } from './state.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';
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
  renameLayout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({
  feedbackService: {
    showHUD: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('WindowManagement RenameLayoutView', () => {
  beforeEach(() => {
    windowManagementState.customLayouts = [
      { id: 'l1', name: 'Left Split', bounds: { x: 0, y: 0, width: 720, height: 900 } },
    ];
    windowManagementState.startRename('l1');
  });

  afterEach(() => {
    windowManagementState.reset();
    vi.restoreAllMocks();
  });

  it('registers Mod+Enter primary action and prefills existing layout name', () => {
    render(RenameLayoutView);

    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Left Split');
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();

    const saveAction = actionService
      .getAllActions()
      .find((a) => a.id === 'window-management:rename-save');
    expect(saveAction?.shortcut).toBe('Mod+Enter');
    expect(saveAction?.primary).toBe(true);
  });

  it('renames layout and calls viewManager.goBack on save', async () => {
    const goBackSpy = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});
    render(RenameLayoutView);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    input.value = 'Focus Layout';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const saveAction = actionService
      .getAllActions()
      .find((a) => a.id === 'window-management:rename-save');
    await saveAction?.execute();

    expect(renameLayout).toHaveBeenCalledWith('l1', 'Focus Layout', undefined);
    expect(goBackSpy).toHaveBeenCalledTimes(1);
    expect(windowManagementState.renamingLayoutId).toBeNull();
  });
});
