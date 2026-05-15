import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./invokeSafe', () => ({ invokeSafe: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../services/log/logService', () => ({ logService: { warn: vi.fn() } }));

import { invokeSafe } from './invokeSafe';
import { invoke } from '@tauri-apps/api/core';
import {
  mcpListServers,
  mcpInstallServer,
  mcpTestServer,
  mcpSetServerEnabled,
  mcpUninstallServer,
  mcpListAudit,
  mcpDetectExistingConfigs,
  mcpParseConfigJson,
  mcpInvokeTool,
  mcpSetPermission,
  mcpGetPermission,
} from './mcpCommands';
import type { McpServerInstallInput } from '../../built-in-features/mcp/types';

const mockInvoke = invokeSafe as ReturnType<typeof vi.fn>;
const mockTauriInvoke = invoke as ReturnType<typeof vi.fn>;

const sampleInput: McpServerInstallInput = {
  id: 'my-server',
  displayName: 'My Server',
  description: null,
  transport: { kind: 'stdio', command: 'npx', args: ['my-mcp'], env: {}, cwd: null },
};

const sampleSummary = {
  id: 'my-server',
  displayName: 'My Server',
  description: null,
  transportKind: 'stdio',
  enabled: true,
  status: 'connected' as const,
  toolsCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mcpListServers', () => {
  it('calls invokeSafe with mcp_list_servers and no args', async () => {
    mockInvoke.mockResolvedValue([]);
    await mcpListServers();
    expect(mockInvoke).toHaveBeenCalledWith('mcp_list_servers');
  });

  it('returns the array on success', async () => {
    mockInvoke.mockResolvedValue([sampleSummary]);
    const result = await mcpListServers();
    expect(result).toEqual([sampleSummary]);
  });
});

describe('mcpInstallServer', () => {
  it('passes correct args + command name', async () => {
    mockInvoke.mockResolvedValue(sampleSummary);
    await mcpInstallServer(sampleInput);
    expect(mockInvoke).toHaveBeenCalledWith('mcp_install_server', { input: sampleInput });
  });
});

describe('mcpTestServer', () => {
  it('passes correct args + command name', async () => {
    mockInvoke.mockResolvedValue({ toolsCount: 2, error: null });
    await mcpTestServer(sampleInput);
    expect(mockInvoke).toHaveBeenCalledWith('mcp_test_server', { input: sampleInput });
  });
});

describe('mcpSetServerEnabled', () => {
  it('passes serverId + enabled correctly and returns true on success', async () => {
    mockTauriInvoke.mockResolvedValue(undefined);
    const result = await mcpSetServerEnabled('my-server', true);
    expect(mockTauriInvoke).toHaveBeenCalledWith('mcp_set_server_enabled', {
      serverId: 'my-server',
      enabled: true,
    });
    expect(result).toBe(true);
  });

  it('returns false when invoke throws', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('Rust error'));
    const result = await mcpSetServerEnabled('my-server', true);
    expect(result).toBe(false);
  });
});

describe('mcpUninstallServer', () => {
  it('passes serverId correctly and returns true on success', async () => {
    mockTauriInvoke.mockResolvedValue(undefined);
    const result = await mcpUninstallServer('my-server');
    expect(mockTauriInvoke).toHaveBeenCalledWith('mcp_uninstall_server', { serverId: 'my-server' });
    expect(result).toBe(true);
  });

  it('returns false when invoke throws', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('Rust error'));
    const result = await mcpUninstallServer('my-server');
    expect(result).toBe(false);
  });
});

describe('mcpListAudit', () => {
  it('passes serverId (null) + limit', async () => {
    mockInvoke.mockResolvedValue([]);
    await mcpListAudit(null, 50);
    expect(mockInvoke).toHaveBeenCalledWith('mcp_list_audit', { serverId: null, limit: 50 });
  });
});

describe('mcpDetectExistingConfigs', () => {
  it('has no args + correct command', async () => {
    mockInvoke.mockResolvedValue([]);
    await mcpDetectExistingConfigs();
    expect(mockInvoke).toHaveBeenCalledWith('mcp_detect_existing_configs');
  });
});

describe('mcpParseConfigJson', () => {
  it('passes json string', async () => {
    mockInvoke.mockResolvedValue([]);
    await mcpParseConfigJson('{"servers":{}}');
    expect(mockInvoke).toHaveBeenCalledWith('mcp_parse_config_json', { json: '{"servers":{}}' });
  });
});

describe('mcpInvokeTool', () => {
  it('passes serverId + toolId + args (+ optional agentId)', async () => {
    mockInvoke.mockResolvedValue({ result: 'ok' });
    await mcpInvokeTool('my-server', 'my-tool', { x: 1 }, 'agent-42');
    expect(mockInvoke).toHaveBeenCalledWith('mcp_invoke_tool', {
      serverId: 'my-server',
      toolId: 'my-tool',
      agentId: 'agent-42',
      args: { x: 1 },
    });
  });
});

describe('null returns from wrappers', () => {
  it('return null when invokeSafe returns null', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await mcpListServers();
    expect(result).toBeNull();
  });
});

describe('mcpSetPermission', () => {
  it('passes correct args and command name', async () => {
    mockTauriInvoke.mockResolvedValue(undefined);
    const result = await mcpSetPermission('my-server', 'create_user', 'agent-1', 'allow_once');
    expect(mockTauriInvoke).toHaveBeenCalledWith('mcp_set_permission', {
      serverId: 'my-server',
      toolId: 'create_user',
      agentId: 'agent-1',
      decision: 'allow_once',
    });
    expect(result).toBe(true);
  });

  it('returns false when invoke throws', async () => {
    mockTauriInvoke.mockRejectedValue(new Error('Rust error'));
    const result = await mcpSetPermission('my-server', 'create_user', 'agent-1', 'allow_always');
    expect(result).toBe(false);
  });
});

describe('mcpGetPermission', () => {
  it('passes correct args and returns the decision string', async () => {
    mockInvoke.mockResolvedValue('allow_always');
    const result = await mcpGetPermission('my-server', 'create_user', 'agent-1');
    expect(mockInvoke).toHaveBeenCalledWith('mcp_get_permission', {
      serverId: 'my-server',
      toolId: 'create_user',
      agentId: 'agent-1',
    });
    expect(result).toBe('allow_always');
  });

  it('returns null when invokeSafe returns null', async () => {
    mockInvoke.mockResolvedValue(null);
    const result = await mcpGetPermission('my-server', 'create_user', 'agent-1');
    expect(result).toBeNull();
  });
});
