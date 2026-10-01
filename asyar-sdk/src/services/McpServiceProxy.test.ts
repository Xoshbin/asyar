/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

import { McpServiceProxy } from './McpServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

describe('McpServiceProxy', () => {
  let proxy: McpServiceProxy;
  let mockInvoke: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = vi.fn().mockResolvedValue([]);
    Object.assign(messageBroker, {
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    });
    proxy = new McpServiceProxy();
    proxy.setExtensionId('test.extension');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listServers', () => {
    it('invokes mcp:listServers and returns servers list', async () => {
      const mockServers = [
        { id: 'server-1', name: 'GitHub MCP', enabled: true, toolsCount: 5 },
        { id: 'server-2', name: 'Filesystem MCP', enabled: false, toolsCount: 2 },
      ];
      mockInvoke.mockResolvedValueOnce(mockServers);

      const servers = await proxy.listServers();

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:listServers',
        undefined,
        'test.extension',
        undefined,
      );
      expect(servers).toEqual(mockServers);
    });

    it('returns empty array when invoke returns null or undefined', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      const servers = await proxy.listServers();

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:listServers',
        undefined,
        'test.extension',
        undefined,
      );
      expect(servers).toEqual([]);
    });
  });

  describe('listTools', () => {
    it('invokes mcp:listTools with serverId and returns tools list', async () => {
      const mockTools = [
        {
          name: 'get_file',
          description: 'Get file content',
          inputSchema: { type: 'object' },
          serverId: 'server-1',
        },
      ];
      mockInvoke.mockResolvedValueOnce(mockTools);

      const tools = await proxy.listTools('server-1');

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:listTools',
        { serverId: 'server-1' },
        'test.extension',
        undefined,
      );
      expect(tools).toEqual(mockTools);
    });

    it('invokes mcp:listTools without serverId to list all tools', async () => {
      const mockTools = [
        { name: 'tool_a', description: null, inputSchema: {} },
        { name: 'tool_b', description: 'B', inputSchema: {} },
      ];
      mockInvoke.mockResolvedValueOnce(mockTools);

      const tools = await proxy.listTools();

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:listTools',
        { serverId: undefined },
        'test.extension',
        undefined,
      );
      expect(tools).toEqual(mockTools);
    });

    it('returns empty array when invoke returns null or undefined', async () => {
      mockInvoke.mockResolvedValueOnce(null);

      const tools = await proxy.listTools('missing-server');

      expect(tools).toEqual([]);
    });
  });

  describe('invokeTool', () => {
    it('invokes mcp:invokeTool with serverId, toolId, and args', async () => {
      mockInvoke.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Success' }] });

      const result = await proxy.invokeTool('server-1', 'fetch_data', { query: 'test' });

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:invokeTool',
        {
          serverId: 'server-1',
          toolId: 'fetch_data',
          args: { query: 'test' },
        },
        'test.extension',
        undefined,
      );
      expect(result).toEqual({ content: [{ type: 'text', text: 'Success' }] });
    });

    it('passes empty object when args is not provided or nullish', async () => {
      mockInvoke.mockResolvedValueOnce({ status: 'ok' });

      const result = await proxy.invokeTool('server-1', 'ping', undefined as any);

      expect(mockInvoke).toHaveBeenCalledWith(
        'mcp:invokeTool',
        {
          serverId: 'server-1',
          toolId: 'ping',
          args: {},
        },
        'test.extension',
        undefined,
      );
      expect(result).toEqual({ status: 'ok' });
    });

    it('throws error when serverId is empty or missing', async () => {
      await expect(proxy.invokeTool('', 'tool-1', {})).rejects.toThrow('serverId is required');
      await expect(proxy.invokeTool(null as any, 'tool-1', {})).rejects.toThrow(
        'serverId is required',
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('throws error when toolId is empty or missing', async () => {
      await expect(proxy.invokeTool('server-1', '', {})).rejects.toThrow('toolId is required');
      await expect(proxy.invokeTool('server-1', null as any, {})).rejects.toThrow(
        'toolId is required',
      );
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('propagates invocation errors thrown by broker', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Permission denied'));

      await expect(proxy.invokeTool('server-1', 'secret_tool', {})).rejects.toThrow(
        'Permission denied',
      );
    });
  });
});
