import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/mcpCommands', () => ({
  mcpListServers: vi.fn(),
  mcpInstallServer: vi.fn(),
  mcpTestServer: vi.fn(),
  mcpSetServerEnabled: vi.fn(),
  mcpUninstallServer: vi.fn(),
  mcpListAudit: vi.fn(),
  mcpDetectExistingConfigs: vi.fn(),
  mcpParseConfigJson: vi.fn(),
  mcpInvokeTool: vi.fn(),
  mcpSetPermission: vi.fn(),
  mcpGetPermission: vi.fn(),
}));

import * as cmds from '../../lib/ipc/mcpCommands';
import { McpService } from './mcpService.svelte';
import type { McpServerSummary, McpServerInstallInput } from './types';

const makeSummary = (over: Partial<McpServerSummary> = {}): McpServerSummary => ({
  id: 'srv-1',
  displayName: 'Server One',
  description: null,
  transportKind: 'stdio',
  enabled: true,
  status: 'connected',
  toolsCount: 2,
  ...over,
});

const makeInput = (over: Partial<McpServerInstallInput> = {}): McpServerInstallInput => ({
  id: 'srv-1',
  displayName: 'Server One',
  description: null,
  transport: { kind: 'stdio', command: 'npx', args: [], env: {}, cwd: null },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcpService.refreshServers', () => {
  it('populates servers from mcpListServers', async () => {
    const srv = makeSummary();
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([srv]);
    const svc = new McpService();
    await svc.refreshServers();
    expect(svc.servers).toEqual([srv]);
  });
});

describe('mcpService.refresh', () => {
  it('fetches both servers and audit, sets loading false', async () => {
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([makeSummary()]);
    (cmds.mcpListAudit as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (cmds.mcpDetectExistingConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new McpService();
    await svc.refresh();
    expect(svc.loading).toBe(false);
    expect(cmds.mcpListServers).toHaveBeenCalled();
    expect(cmds.mcpListAudit).toHaveBeenCalled();
  });

  it('calls detectConfigs only when servers list is empty after refresh', async () => {
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (cmds.mcpListAudit as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (cmds.mcpDetectExistingConfigs as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new McpService();
    await svc.refresh();
    expect(cmds.mcpDetectExistingConfigs).toHaveBeenCalled();
  });
});

describe('mcpService.install', () => {
  it('pushes the new server (verifies refreshServers ran)', async () => {
    const input = makeInput();
    const returned = makeSummary({ id: 'srv-1', toolsCount: 5 });
    const refreshed = makeSummary({ id: 'srv-1', toolsCount: 5 });
    (cmds.mcpInstallServer as ReturnType<typeof vi.fn>).mockResolvedValue(returned);
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([refreshed]);
    const svc = new McpService();
    await svc.install(input);
    expect(cmds.mcpListServers).toHaveBeenCalled();
    expect(svc.servers).toContainEqual(refreshed);
  });
});

describe('mcpService.setEnabled', () => {
  it('refreshes servers after success', async () => {
    const updated = makeSummary({ enabled: false });
    (cmds.mcpSetServerEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([updated]);
    const svc = new McpService();
    await svc.setEnabled('srv-1', false);
    expect(cmds.mcpListServers).toHaveBeenCalled();
    expect(svc.servers).toContainEqual(updated);
  });

  it('does not refresh servers when command fails', async () => {
    (cmds.mcpSetServerEnabled as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = new McpService();
    svc.servers = [makeSummary()];
    await svc.setEnabled('srv-1', false);
    expect(cmds.mcpListServers).not.toHaveBeenCalled();
  });
});

describe('mcpService.uninstall', () => {
  it('removes the server after refreshServers re-runs', async () => {
    (cmds.mcpUninstallServer as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new McpService();
    svc.servers = [makeSummary()];
    await svc.uninstall('srv-1');
    expect(cmds.mcpListServers).toHaveBeenCalled();
    expect(svc.servers).toEqual([]);
  });

  it('does not refresh servers when command fails', async () => {
    (cmds.mcpUninstallServer as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const svc = new McpService();
    svc.servers = [makeSummary()];
    await svc.uninstall('srv-1');
    expect(cmds.mcpListServers).not.toHaveBeenCalled();
  });
});

describe('mcpService.parseConfigJson', () => {
  it('forwards the json and returns the parsed array', async () => {
    const parsed = [makeInput()];
    (cmds.mcpParseConfigJson as ReturnType<typeof vi.fn>).mockResolvedValue(parsed);
    const svc = new McpService();
    const result = await svc.parseConfigJson('{}');
    expect(cmds.mcpParseConfigJson).toHaveBeenCalledWith('{}');
    expect(result).toEqual(parsed);
  });
});

describe('mcpService null handling', () => {
  it('null returns from wrappers do NOT clobber state', async () => {
    (cmds.mcpListServers as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new McpService();
    svc.servers = [makeSummary()];
    await svc.refreshServers();
    expect(svc.servers).toEqual([makeSummary()]);
  });
});

describe('mcpService.requestPermission', () => {
  it('stores prompt and resolves on handlePermissionDecision', async () => {
    const svc = new McpService();
    const promise = svc.requestPermission('srv-1', 'create_user', 'agent-1');
    expect(svc.permissionPrompt).not.toBeNull();
    expect(svc.permissionPrompt?.serverId).toBe('srv-1');
    expect(svc.permissionPrompt?.toolId).toBe('create_user');
    expect(svc.permissionPrompt?.agentId).toBe('agent-1');
    svc.handlePermissionDecision('allow_once');
    const result = await promise;
    expect(result).toBe('allow_once');
    expect(svc.permissionPrompt).toBeNull();
  });
});

describe('mcpService.handlePermissionDecision', () => {
  it('sets server permission via mcpSetPermission for non-cancel decisions', async () => {
    (cmds.mcpSetPermission as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const svc = new McpService();
    const promise = svc.requestPermission('srv-1', 'create_user', 'agent-1');
    svc.handlePermissionDecision('allow_always');
    await promise;
    expect(cmds.mcpSetPermission).toHaveBeenCalledWith(
      'srv-1', 'create_user', 'agent-1', 'allow_always',
    );
  });

  it('does NOT call mcpSetPermission on cancel', async () => {
    (cmds.mcpSetPermission as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const svc = new McpService();
    const promise = svc.requestPermission('srv-1', 'create_user', 'agent-1');
    svc.handlePermissionDecision('cancel');
    await promise;
    expect(cmds.mcpSetPermission).not.toHaveBeenCalled();
  });
});
