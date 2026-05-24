export interface ManifestTool {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ToolFullyQualifiedId = `${string}:${string}`;

export interface ToolDescriptor extends ManifestTool {
  source: 'builtin' | { extensionId: string } | { mcpServerId: string };
  fullyQualifiedId: ToolFullyQualifiedId;
}

export type ToolHandler = (args: unknown) => Promise<unknown>;

export interface IToolsService {
  registerTool(tool: ManifestTool, handler: ToolHandler): Promise<void>;
  unregisterTool(id: string): Promise<void>;
  listTools(): Promise<ToolDescriptor[]>;
}
