import { BaseServiceProxy } from './BaseServiceProxy';
import type { IMcpService, McpServerInfo, McpToolDescriptor } from '../contracts/IMcpService';

/**
 * SDK-side proxy for the host Model Context Protocol (MCP) service.
 * Allows Tier 2 extensions to discover MCP servers, inspect tool definitions,
 * and invoke tools across connected servers.
 */
export class McpServiceProxy extends BaseServiceProxy implements IMcpService {
  async listServers(): Promise<McpServerInfo[]> {
    const servers = await this.broker.invoke<McpServerInfo[]>('mcp:listServers');
    return servers ?? [];
  }

  async listTools(serverId?: string): Promise<McpToolDescriptor[]> {
    const tools = await this.broker.invoke<McpToolDescriptor[]>('mcp:listTools', { serverId });
    return tools ?? [];
  }

  async invokeTool(
    serverId: string,
    toolId: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!serverId || typeof serverId !== 'string') {
      throw new Error('[asyar-sdk/mcp] serverId is required');
    }
    if (!toolId || typeof toolId !== 'string') {
      throw new Error('[asyar-sdk/mcp] toolId is required');
    }
    return this.broker.invoke<unknown>('mcp:invokeTool', {
      serverId,
      toolId,
      args: args ?? {},
    });
  }
}
