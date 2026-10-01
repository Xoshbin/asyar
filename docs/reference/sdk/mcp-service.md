### 8.40 `McpService` — Interact with Model Context Protocol (MCP) servers

**Runs in:** both worker and view.

**Permission required:** `mcp`.

`McpService` provides Tier 2 extensions with programmatic client access to discover configured Model Context Protocol (MCP) servers, inspect available tools, and invoke tools across connected servers.

```typescript
export interface McpServerInfo {
  /** Unique server identifier (e.g. "github", "sqlite", "filesystem"). */
  id: string;
  /** Human-readable display name of the server. */
  name: string;
  /** Whether the server is enabled and configured to run. */
  enabled: boolean;
  /** Number of tools discovered on this server. */
  toolsCount: number;
}

export interface McpToolDescriptor {
  /** Unique tool name within the MCP server. */
  name: string;
  /** Human-readable description of what the tool does. */
  description: string | null;
  /** JSON Schema describing the accepted input arguments. */
  inputSchema: Record<string, unknown>;
  /** Server ID that provides this tool. */
  serverId?: string;
}

export interface IMcpService {
  /**
   * Discovers all configured MCP servers and their current status.
   *
   * @returns Array of configured MCP server summaries.
   */
  listServers(): Promise<McpServerInfo[]>;

  /**
   * Lists tools available across all connected servers or for a specific server.
   *
   * @param serverId - Optional server ID to filter tools for a specific server.
   *                   If omitted, aggregates tools across all active servers.
   * @returns Array of MCP tool descriptors with JSON schemas.
   */
  listTools(serverId?: string): Promise<McpToolDescriptor[]>;

  /**
   * Invokes an MCP tool on the target server.
   *
   * @param serverId - Target server ID providing the tool.
   * @param toolId - Tool name to execute.
   * @param args - Tool input parameters matching its inputSchema.
   * @returns Result returned by the MCP tool.
   */
  invokeTool(serverId: string, toolId: string, args: Record<string, unknown>): Promise<unknown>;
}
```

**Manifest Declaration:**

```json
{
  "permissions": ["mcp"]
}
```

**Usage (Discovering servers and tools):**

```typescript
import type { IMcpService } from 'asyar-sdk/contracts';

// Using context.mcp or context.getService<IMcpService>('mcp')
const mcp = context.mcp;

// List all configured MCP servers
const servers = await mcp.listServers();
for (const server of servers) {
  console.log(`Server: ${server.name} (${server.id}) - Enabled: ${server.enabled}`);
}

// List all tools across active servers
const allTools = await mcp.listTools();
console.log(`Available tools: ${allTools.length}`);

// Or list tools for a specific server
const gitTools = await mcp.listTools('github');
for (const tool of gitTools) {
  console.log(`Tool: ${tool.name} - ${tool.description}`);
}
```

**Usage (Invoking an MCP tool):**

```typescript
const result = await context.mcp.invokeTool('github', 'get_issue', {
  owner: 'asyar-app',
  repo: 'asyar',
  issue_number: 806,
});

console.log('Issue details:', result);
```

**Security & Permission Gating:**

- **Layer 1 (Manifest Permission):** The extension must declare `"mcp"` in its manifest. Without this declaration, any call to `listServers`, `listTools`, or `invokeTool` is blocked by Asyar's fail-closed permission gate.
- **Layer 2 (User Consent & Strict Mode):** Tools that perform mutations (write tools) or any tool invoked while Strict Mode is enabled require user consent before execution. The caller extension identity is recorded in the host's MCP audit log.

---
