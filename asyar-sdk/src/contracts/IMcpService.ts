export interface McpServerInfo {
  id: string;
  name: string;
  enabled: boolean;
  toolsCount: number;
}

export interface McpToolDescriptor {
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown>;
  serverId?: string;
}

export interface IMcpService {
  listServers(): Promise<McpServerInfo[]>;
  listTools(serverId?: string): Promise<McpToolDescriptor[]>;
  invokeTool(serverId: string, toolId: string, args: Record<string, unknown>): Promise<unknown>;
}
