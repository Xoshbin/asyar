/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./portalStore.svelte', () => ({
  portalStore: {
    portals: [
      { id: 'p1', name: 'Google', url: 'https://google.com?q={query}', icon: '🌐', createdAt: 1 },
    ],
    getById: vi.fn((id: string) =>
      id === 'p1'
        ? {
            id: 'p1',
            name: 'Google',
            url: 'https://google.com?q={query}',
            icon: '🌐',
            createdAt: 1,
          }
        : undefined,
    ),
    getAll: vi.fn(() => [
      { id: 'p1', name: 'Google', url: 'https://google.com?q={query}', icon: '🌐', createdAt: 1 },
    ]),
  },
}));

vi.mock('./portalLifecycle', () => ({
  cleanupLegacyPortalIndexEntries: vi.fn().mockResolvedValue(undefined),
  clearAllPortalsFromIndex: vi.fn().mockResolvedValue(undefined),
  dispatchPortalCommand: vi.fn().mockResolvedValue(undefined),
  openPortal: vi.fn().mockResolvedValue(undefined),
  syncAllPortalsToIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));
vi.mock('./PortalForm.svelte', () => ({ default: {} }));

import portalsExtension, { portalsUiState } from './index.svelte';
import { clearAllPortalsFromIndex, openPortal, syncAllPortalsToIndex } from './portalLifecycle';
import { actionService } from '../../services/action/actionService.svelte';

describe('PortalsExtension', () => {
  let mockExtensionManager: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtensionManager = {
      navigateToView: vi.fn(),
    };
  });

  it('navigates to DefaultView on open-portals command', async () => {
    await portalsExtension.initialize({
      getService: () => mockExtensionManager,
      preferences: { values: {} },
    } as any);

    const res = await portalsExtension.executeCommand('open-portals');
    expect(res).toEqual({ type: 'view', viewPath: 'portals/DefaultView' });
    expect(mockExtensionManager.navigateToView).toHaveBeenCalledWith('portals/DefaultView');
  });

  it('navigates to PortalFormView on create-portal command', async () => {
    const { viewManager } = await import('../../services/extension/viewManager.svelte');
    const navSpy = vi.spyOn(viewManager, 'navigateToView').mockImplementation(() => {});

    const res = await portalsExtension.executeCommand('create-portal');
    expect(res).toEqual({ type: 'view', viewPath: 'portals/PortalFormView' });
    expect(navSpy).toHaveBeenCalledWith('portals/PortalFormView', {
      searchable: false,
    });
    navSpy.mockRestore();
  });

  it('executes dynamic portal command via openPortal', async () => {
    const res = await portalsExtension.executeCommand('p1', { query: 'test search' });
    expect(res).toEqual({ type: 'no-view' });
    expect(openPortal).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', name: 'Google' }), {
      query: 'test search',
    });
  });

  it('registers and unregisters view actions on viewActivated and viewDeactivated', async () => {
    await portalsExtension.viewActivated('portals/DefaultView');
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'portals:new-portal' }),
    );

    await portalsExtension.viewDeactivated('portals/DefaultView');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('portals:new-portal');
    expect(portalsUiState.formMode).toBe('create');
    expect(portalsUiState.editingPortal).toBeNull();
    expect(portalsUiState.selectedIndex).toBe(-1);
  });

  it('pushes portals/PortalFormView with searchable: false on portals:new-portal action', async () => {
    const { viewManager } = await import('../../services/extension/viewManager.svelte');
    const navSpy = vi.spyOn(viewManager, 'navigateToView').mockImplementation(() => {});

    await portalsExtension.viewActivated('portals/DefaultView');
    const newAction = vi
      .mocked(actionService.registerAction)
      .mock.calls.find(([c]) => c.id === 'portals:new-portal')?.[0];

    await newAction?.execute();

    expect(portalsUiState.formMode).toBe('create');
    expect(navSpy).toHaveBeenCalledWith('portals/PortalFormView', { searchable: false });
    navSpy.mockRestore();
  });

  it('clears portals index and resets view state on deactivate', async () => {
    await portalsExtension.deactivate();

    expect(actionService.unregisterAction).toHaveBeenCalledWith('portals:new-portal');
    expect(clearAllPortalsFromIndex).toHaveBeenCalled();
    expect(portalsUiState.formMode).toBe('create');
    expect(portalsUiState.editingPortal).toBeNull();
    expect(portalsUiState.selectedIndex).toBe(-1);
  });

  it('re-syncs portals to index on activate', async () => {
    await portalsExtension.activate();

    expect(syncAllPortalsToIndex).toHaveBeenCalled();
  });
});
