import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./mcpService.svelte', () => ({
  mcpService: {
    refresh: vi.fn().mockResolvedValue(undefined),
    refreshPermissions: vi.fn().mockResolvedValue(undefined),
    setStrictMode: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    strictMode: false,
  },
}));

vi.mock('../../services/action/actionService.svelte', () => ({
  actionService: {
    registerAction: vi.fn(),
    unregisterAction: vi.fn(),
  },
}));

vi.mock('../../services/extension/viewManager.svelte', () => ({
  viewManager: {
    navigateToView: vi.fn(),
  },
}));

// Mock Svelte components
vi.mock('./ManageServersView.svelte', () => ({ default: {} }));
vi.mock('./ImportServersView.svelte', () => ({ default: {} }));
vi.mock('./InstallServerView.svelte', () => ({ default: {} }));
vi.mock('./PermissionsView.svelte', () => ({ default: {} }));
vi.mock('./ActivityView.svelte', () => ({ default: {} }));

import mcpExtension from './index';
import { mcpService } from './mcpService.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

describe('McpExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes executeCommand to view paths', async () => {
    const manageRes = await mcpExtension.executeCommand('manage');
    expect(manageRes).toEqual({ type: 'view', viewPath: 'mcp/ManageServersView' });

    const permRes = await mcpExtension.executeCommand('permissions');
    expect(permRes).toEqual({ type: 'view', viewPath: 'mcp/PermissionsView' });

    await expect(mcpExtension.executeCommand('unknown')).rejects.toThrow('unknown mcp command');
  });

  it('registers and unregisters view actions on viewActivated and viewDeactivated', async () => {
    await mcpExtension.viewActivated('mcp/ManageServersView');
    expect(mcpService.refresh).toHaveBeenCalled();
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mcp:refresh-servers' }),
    );
    expect(actionService.registerAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'mcp:install-server' }),
    );

    await mcpExtension.viewDeactivated('mcp/ManageServersView');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:refresh-servers');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:install-server');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:import-servers');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:view-permissions');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:view-activity');
    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:toggle-strict-mode');
  });

  it('cleans up actions and resets service state on deactivate', async () => {
    await mcpExtension.deactivate();

    expect(actionService.unregisterAction).toHaveBeenCalledWith('mcp:refresh-servers');
    expect(mcpService.reset).toHaveBeenCalled();
  });

  it('refreshes servers on activate', async () => {
    await mcpExtension.activate();

    expect(mcpService.refresh).toHaveBeenCalled();
  });
});
