/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PortalForm from './PortalForm.svelte';
import { portalStore } from './portalStore.svelte';
import { portalsUiState } from './index.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(() => 0),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./portalLifecycle', () => ({
  syncAllPortalsToIndex: vi.fn().mockResolvedValue(undefined),
  syncPortalToIndex: vi.fn().mockResolvedValue(undefined),
  removePortalFromIndex: vi.fn().mockResolvedValue(undefined),
  dispatchPortalCommand: vi.fn().mockResolvedValue(undefined),
  cleanupLegacyPortalIndexEntries: vi.fn().mockResolvedValue(undefined),
  clearAllPortalsFromIndex: vi.fn().mockResolvedValue(undefined),
  openPortal: vi.fn().mockResolvedValue(undefined),
}));

import { syncAllPortalsToIndex } from './portalLifecycle';

describe('Portals PortalFormView', () => {
  beforeEach(() => {
    viewManager.activeView = 'portals/PortalFormView';
    portalStore.portals = [];
    portalsUiState.clearDraft();
  });

  afterEach(() => {
    portalsUiState.clearDraft();
    vi.restoreAllMocks();
  });

  it('registers Mod+Enter primary action without inline Save/Cancel buttons in create mode', () => {
    portalsUiState.startCreate();
    render(PortalForm);

    expect(screen.getByText('Create Portal')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();

    const saveAction = actionService.getAllActions().find((a) => a.id === 'portals:save');
    expect(saveAction?.shortcut).toBe('Mod+Enter');
    expect(saveAction?.primary).toBe(true);
  });

  it('prefills fields in edit mode and pops back via viewManager.goBack on save', async () => {
    const existing = {
      id: 'google',
      name: 'Search Google',
      url: 'https://google.com/search?q={query}',
      icon: '🌐',
      createdAt: 100,
    };
    portalStore.portals = [existing];
    portalsUiState.startEdit(existing);
    const goBackSpy = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});

    render(PortalForm);

    expect(screen.getByText('Update Portal')).toBeTruthy();
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe('Search Google');

    const saveAction = actionService.getAllActions().find((a) => a.id === 'portals:save');
    await saveAction?.execute();

    expect(goBackSpy).toHaveBeenCalledTimes(1);
    expect(portalsUiState.formMode).toBe('create');
    expect(portalsUiState.editingPortal).toBeNull();
  });

  it('does not pop again after cancel during syncAllPortalsToIndex', async () => {
    portalsUiState.startEdit({
      id: 'p',
      name: 'Portal',
      url: 'https://example.com',
      icon: '',
      createdAt: 1,
    });
    const goBack = vi.spyOn(viewManager, 'goBack').mockImplementation(() => {});
    render(PortalForm);
    let resolve!: () => void;
    vi.mocked(syncAllPortalsToIndex).mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const pending = actionService
      .getAllActions()
      .find((a) => a.id === 'portals:save')!
      .execute();
    viewManager.tryInterceptEscape();
    resolve();
    await pending;
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
