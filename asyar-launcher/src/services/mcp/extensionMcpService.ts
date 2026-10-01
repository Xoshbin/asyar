import { mcpListServers, mcpListServerTools, mcpInvokeToolRaw } from '../../lib/ipc/mcpCommands';
import type { McpServerInfo, McpToolDescriptor } from 'asyar-sdk/contracts';

/**
 * Host-side service backing Tier 2 extension MCP operations.
 * Handles server discovery, tool enumeration, and tool invocation with caller identity propagation.
 */
export class ExtensionMcpService {
  async listServers(_extensionId?: string): Promise<McpServerInfo[]> {
    const servers = await mcpListServers();
    if (!servers) return [];
    return servers.map((s) => ({
      id: s.id,
      name: s.displayName,
      enabled: s.enabled,
      toolsCount: s.toolsCount,
    }));
  }

  async listTools(
    extensionIdOrServerId?: string,
    maybeServerId?: string,
  ): Promise<McpToolDescriptor[]> {
    const serverId = arguments.length >= 2 ? maybeServerId : extensionIdOrServerId;
    if (serverId) {
      const tools = await mcpListServerTools(serverId);
      if (!tools) return [];
      return tools.map((t) => ({ ...t, serverId }));
    }

    const servers = await mcpListServers();
    if (!servers) return [];

    const activeServers = servers.filter((s) => s.enabled);
    const results = await Promise.allSettled(
      activeServers.map(async (server) => {
        const tools = await mcpListServerTools(server.id);
        if (!tools) return [];
        return tools.map((t) => ({ ...t, serverId: server.id }));
      }),
    );

    const allTools: McpToolDescriptor[] = [];
    for (const res of results) {
      if (res.status === 'fulfilled') {
        allTools.push(...res.value);
      }
    }
    return allTools;
  }

  async invokeTool(
    extensionIdOrServerId: string,
    serverIdOrToolId: string,
    toolIdOrArgs: string | Record<string, unknown>,
    maybeArgs?: Record<string, unknown>,
  ): Promise<unknown> {
    let extensionId: string | undefined;
    let serverId: string;
    let toolId: string;
    let args: Record<string, unknown>;

    if (typeof toolIdOrArgs === 'string') {
      extensionId = extensionIdOrServerId;
      serverId = serverIdOrToolId;
      toolId = toolIdOrArgs;
      args = maybeArgs ?? {};
    } else {
      serverId = extensionIdOrServerId;
      toolId = serverIdOrToolId;
      args = (toolIdOrArgs as Record<string, unknown>) ?? {};
    }

    if (!serverId || typeof serverId !== 'string') {
      throw new Error('serverId is required to invoke an MCP tool');
    }
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('toolId is required to invoke an MCP tool');
    }

    return mcpInvokeToolRaw(serverId, toolId, args, extensionId);
  }
}

export const extensionMcpService = new ExtensionMcpService();
