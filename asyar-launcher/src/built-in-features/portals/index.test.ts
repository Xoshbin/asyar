/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/placeholders', () => ({
  resolveTemplate: vi.fn(async (url: string, context?: { query?: string }) => {
    return url.replace('{query}', encodeURIComponent(context?.query ?? ''));
  }),
}));

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
  syncPortalToIndex: vi.fn().mockResolvedValue(undefined),
  removePortalFromIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/ipc/commands', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('./DefaultView.svelte', () => ({ default: {} }));

import portalsExtension, { portalsUiState } from './index.svelte';
import { syncPortalToIndex, removePortalFromIndex } from './portalLifecycle';
import { actionService } from '../../services/action/actionService.svelte';
import { openUrl } from '../../lib/ipc/commands';

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

  it('executes dynamic portal command by resolving template and opening url', async () => {
    const res = await portalsExtension.executeCommand('p1', { query: 'test search' });
    expect(res).toEqual({ type: 'no-view' });
    expect(openUrl).toHaveBeenCalledWith('https://google.com?q=test%20search');
  });

  it('registers and unregisters view actions on viewActivated and viewDeactivated', async () => {
    await portalsExtension.viewActivated('portals/DefaultView');
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'portals:new-portal' }),
    );

    await portalsExtension.viewDeactivated('portals/DefaultView');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('portals:new-portal');
    expect(portalsUiState.openMode).toBe('list');
    expect(portalsUiState.selectedIndex).toBe(-1);
  });

  it('unindexes portals and resets view state on deactivate', async () => {
    await portalsExtension.deactivate();

    expect(actionService.unregisterAction).toHaveBeenCalledWith('portals:new-portal');
    expect(removePortalFromIndex).toHaveBeenCalledWith('p1');
    expect(portalsUiState.openMode).toBe('list');
    expect(portalsUiState.selectedIndex).toBe(-1);
  });

  it('re-syncs portals to index on activate', async () => {
    await portalsExtension.activate();

    expect(syncPortalToIndex).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', name: 'Google' }),
    );
  });
});
