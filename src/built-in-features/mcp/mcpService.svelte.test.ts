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
  mcpListServerTools: vi.fn(),
  mcpListPermissions: vi.fn(),
  mcpDeletePermission: vi.fn(),
  mcpGetStrictMode: vi.fn().mockResolvedValue(false),
  mcpSetStrictMode: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('../../services/log/logService', () => ({
  logService: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import * as cmds from '../../lib/ipc/mcpCommands';
import { McpService } from './mcpService.svelte';
import type { McpServerSummary, McpServerInstallInput, McpPermissionRow, McpToolDescriptor } from './types';

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

describe('mcpService.listServerTools', () => {
  it('forwards serverId and returns tool descriptors', async () => {
    const tools: McpToolDescriptor[] = [
      { name: 'search', description: 'Search docs', inputSchema: { type: 'object' } },
    ];
    (cmds.mcpListServerTools as ReturnType<typeof vi.fn>).mockResolvedValue(tools);
    const svc = new McpService();
    const result = await svc.listServerTools('srv-1');
    expect(cmds.mcpListServerTools).toHaveBeenCalledWith('srv-1');
    expect(result).toEqual(tools);
  });
});

describe('mcpService.refreshPermissions', () => {
  it('populates permissions from mcpListPermissions', async () => {
    const rows: McpPermissionRow[] = [
      { serverId: 'srv-1', toolId: 'tool-a', agentId: 'agent-1', decision: 'allow_always', setAt: 1000 },
    ];
    (cmds.mcpListPermissions as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
    const svc = new McpService();
    await svc.refreshPermissions();
    expect(svc.permissions).toEqual(rows);
  });

  it('null return does not clobber existing permissions', async () => {
    (cmds.mcpListPermissions as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const svc = new McpService();
    const existing: McpPermissionRow[] = [
      { serverId: 'srv-1', toolId: 'tool-a', agentId: 'agent-1', decision: 'never', setAt: 2000 },
    ];
    svc.permissions = existing;
    await svc.refreshPermissions();
    expect(svc.permissions).toEqual(existing);
  });
});

describe('mcpService.deletePermission', () => {
  it('deletes then refreshes permissions', async () => {
    (cmds.mcpDeletePermission as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    (cmds.mcpListPermissions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new McpService();
    await svc.deletePermission('srv-1', 'tool-a', 'agent-1');
    expect(cmds.mcpDeletePermission).toHaveBeenCalledWith('srv-1', 'tool-a', 'agent-1');
    expect(cmds.mcpListPermissions).toHaveBeenCalled();
    expect(svc.permissions).toEqual([]);
  });
});

describe('mcpService status event listener', () => {
  it('updates the matching server row when an mcp:status_changed event fires', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    let handler: ((e: { payload: { serverId: string; status: string; toolsCount: number } }) => void) | null = null;
    (listen as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_name: string, cb: typeof handler) => {
        handler = cb;
        return () => {};
      },
    );

    const svc = new McpService();
    svc.servers = [
      makeSummary({ id: 'srv-1', status: 'starting', toolsCount: 0 }),
      makeSummary({ id: 'srv-2', status: 'connected', toolsCount: 5 }),
    ];

    // Wait a microtask so the constructor's async listen() resolves.
    await Promise.resolve();
    await Promise.resolve();

    expect(handler).not.toBeNull();
    handler!({ payload: { serverId: 'srv-1', status: 'connected', toolsCount: 3 } });

    expect(svc.servers[0].status).toBe('connected');
    expect(svc.servers[0].toolsCount).toBe(3);
    expect(svc.servers[1].status).toBe('connected');
    expect(svc.servers[1].toolsCount).toBe(5);
  });

  it('ignores events for unknown server ids', async () => {
    const { listen } = await import('@tauri-apps/api/event');
    let handler: ((e: { payload: { serverId: string; status: string; toolsCount: number } }) => void) | null = null;
    (listen as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_name: string, cb: typeof handler) => {
        handler = cb;
        return () => {};
      },
    );

    const svc = new McpService();
    svc.servers = [makeSummary({ id: 'srv-1', status: 'connected', toolsCount: 2 })];
    await Promise.resolve();
    await Promise.resolve();

    handler!({ payload: { serverId: 'unknown', status: 'failed', toolsCount: 0 } });
    expect(svc.servers[0].status).toBe('connected');
    expect(svc.servers[0].toolsCount).toBe(2);
  });
});
