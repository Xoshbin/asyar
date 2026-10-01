import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ipc/mcpCommands', () => ({
  mcpListServers: vi.fn(),
  mcpListServerTools: vi.fn(),
  mcpInvokeToolRaw: vi.fn(),
}));

import { ExtensionMcpService } from './extensionMcpService';
import { mcpListServers, mcpListServerTools, mcpInvokeToolRaw } from '../../lib/ipc/mcpCommands';

describe('ExtensionMcpService', () => {
  let service: ExtensionMcpService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExtensionMcpService();
  });

  describe('listServers', () => {
    it('returns mapped McpServerInfo array', async () => {
      vi.mocked(mcpListServers).mockResolvedValueOnce([
        {
          id: 'server-1',
          displayName: 'GitHub Tools',
          description: 'GitHub integration',
          transportKind: 'stdio',
          enabled: true,
          status: 'connected',
          toolsCount: 4,
        },
        {
          id: 'server-2',
          displayName: 'Postgres MCP',
          description: null,
          transportKind: 'stdio',
          enabled: false,
          status: 'disabled',
          toolsCount: 0,
        },
      ]);

      const result = await service.listServers('org.example.ext');

      expect(result).toEqual([
        { id: 'server-1', name: 'GitHub Tools', enabled: true, toolsCount: 4 },
        { id: 'server-2', name: 'Postgres MCP', enabled: false, toolsCount: 0 },
      ]);
    });

    it('returns empty array when mcpListServers returns null', async () => {
      vi.mocked(mcpListServers).mockResolvedValueOnce(null);

      const result = await service.listServers();
      expect(result).toEqual([]);
    });
  });

  describe('listTools', () => {
    it('returns tools for a specific server when serverId is provided', async () => {
      vi.mocked(mcpListServerTools).mockResolvedValueOnce([
        {
          name: 'get_issues',
          description: 'Get repository issues',
          inputSchema: { type: 'object' },
        },
      ]);

      const result = await service.listTools('org.example.ext', 'server-1');

      expect(mcpListServerTools).toHaveBeenCalledWith('server-1');
      expect(result).toEqual([
        {
          name: 'get_issues',
          description: 'Get repository issues',
          inputSchema: { type: 'object' },
          serverId: 'server-1',
        },
      ]);
    });

    it('returns tools for specific server when called directly with serverId only', async () => {
      vi.mocked(mcpListServerTools).mockResolvedValueOnce([
        {
          name: 'read_query',
          description: null,
          inputSchema: {},
        },
      ]);

      const result = await service.listTools('server-db');

      expect(mcpListServerTools).toHaveBeenCalledWith('server-db');
      expect(result).toEqual([
        {
          name: 'read_query',
          description: null,
          inputSchema: {},
          serverId: 'server-db',
        },
      ]);
    });

    it('returns empty array when mcpListServerTools returns null', async () => {
      vi.mocked(mcpListServerTools).mockResolvedValueOnce(null);

      const result = await service.listTools('org.example.ext', 'missing-server');
      expect(result).toEqual([]);
    });

    it('aggregates tools across active servers when serverId is omitted', async () => {
      vi.mocked(mcpListServers).mockResolvedValueOnce([
        {
          id: 'server-1',
          displayName: 'Server 1',
          description: null,
          transportKind: 'stdio',
          enabled: true,
          status: 'connected',
          toolsCount: 1,
        },
        {
          id: 'server-2',
          displayName: 'Server 2',
          description: null,
          transportKind: 'stdio',
          enabled: false,
          status: 'disabled',
          toolsCount: 1,
        },
        {
          id: 'server-3',
          displayName: 'Server 3',
          description: null,
          transportKind: 'stdio',
          enabled: true,
          status: 'connected',
          toolsCount: 1,
        },
      ]);

      vi.mocked(mcpListServerTools)
        .mockResolvedValueOnce([{ name: 's1_tool', description: 'Tool 1', inputSchema: {} }])
        .mockResolvedValueOnce([{ name: 's3_tool', description: 'Tool 3', inputSchema: {} }]);

      const result = await service.listTools('org.example.ext', undefined);

      expect(mcpListServerTools).toHaveBeenCalledWith('server-1');
      expect(mcpListServerTools).not.toHaveBeenCalledWith('server-2');
      expect(mcpListServerTools).toHaveBeenCalledWith('server-3');
      expect(result).toEqual([
        { name: 's1_tool', description: 'Tool 1', inputSchema: {}, serverId: 'server-1' },
        { name: 's3_tool', description: 'Tool 3', inputSchema: {}, serverId: 'server-3' },
      ]);
    });

    it('returns empty array if server listing returns null during aggregate listTools', async () => {
      vi.mocked(mcpListServers).mockResolvedValueOnce(null);

      const result = await service.listTools();
      expect(result).toEqual([]);
    });
  });

  describe('invokeTool', () => {
    it('calls mcpInvokeToolRaw with extensionId injected', async () => {
      vi.mocked(mcpInvokeToolRaw).mockResolvedValueOnce({ success: true, count: 42 });

      const result = await service.invokeTool('org.example.ext', 'server-1', 'fetch_data', {
        filter: 'active',
      });

      expect(mcpInvokeToolRaw).toHaveBeenCalledWith(
        'server-1',
        'fetch_data',
        { filter: 'active' },
        'org.example.ext',
      );
      expect(result).toEqual({ success: true, count: 42 });
    });

    it('calls mcpInvokeToolRaw without extensionId when called directly with 3 args', async () => {
      vi.mocked(mcpInvokeToolRaw).mockResolvedValueOnce('pong');

      const result = await service.invokeTool('server-1', 'ping', { ping: true });

      expect(mcpInvokeToolRaw).toHaveBeenCalledWith('server-1', 'ping', { ping: true }, undefined);
      expect(result).toBe('pong');
    });

    it('throws error when serverId is empty', async () => {
      await expect(service.invokeTool('org.example.ext', '', 'tool-1', {})).rejects.toThrow(
        'serverId is required',
      );
    });

    it('throws error when toolId is empty', async () => {
      await expect(service.invokeTool('org.example.ext', 'server-1', '', {})).rejects.toThrow(
        'toolId is required',
      );
    });

    it('propagates invocation errors thrown by mcpInvokeToolRaw', async () => {
      vi.mocked(mcpInvokeToolRaw).mockRejectedValueOnce(new Error('Permission denied'));

      await expect(service.invokeTool('org.example.ext', 'server-1', 'tool-1', {})).rejects.toThrow(
        'Permission denied',
      );
    });
  });
});
