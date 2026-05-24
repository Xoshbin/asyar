### 8.30 `ToolsService` — Register tools your extension exports to the agent runtime

**Runs in:** worker only.

**Permission required:** `tools:register`.

`ToolsService` lets an extension contribute callable tools to Asyar's agent runtime. Once registered, your tools appear alongside built-in tools (calculator, clipboard, shell, etc.) and MCP-sourced tools in the tool list available to any running agent. When an agent decides to invoke one of your tools, the launcher routes the call back to your worker's registered handler.

```typescript
export interface ManifestTool {
  id: string;          // Short identifier, no colons allowed (e.g. "lookup-contact")
  name: string;        // Human-readable label shown to the agent
  description: string; // What the tool does — the agent uses this for selection
  parameters: Record<string, unknown>; // JSON Schema describing the tool's input
}

/**
 * The source discriminant attached by the registry when the tool is stored.
 * 'builtin'           — ships with the launcher.
 * { extensionId }     — contributed by a Tier 2 extension via ToolsService.
 * { mcpServerId }     — contributed by an MCP server.
 */
export type ToolSource =
  | 'builtin'
  | { extensionId: string }
  | { mcpServerId: string };

export interface ToolDescriptor extends ManifestTool {
  source: ToolSource;
  /**
   * Globally unique tool address in `<extensionId>:<toolId>` format.
   * Built by the Rust registry at registration time.
   */
  fullyQualifiedId: ToolFullyQualifiedId; // e.g. "org.asyar.contacts:lookup-contact"
}

/** A handler receives the parsed args object and must return a serialisable result. */
export type ToolHandler = (args: unknown) => Promise<unknown>;

export interface IToolsService {
  /**
   * Register a tool and its handler. If a tool with the same id was already
   * registered by this extension, it is replaced (replace-style per the Rust
   * registry's register_tier2 semantics).
   */
  registerTool(tool: ManifestTool, handler: ToolHandler): Promise<void>;

  /**
   * Remove a previously registered tool by its short id (not the fully-qualified id).
   * A no-op if the tool was never registered.
   */
  unregisterTool(id: string): Promise<void>;

  /**
   * Return a snapshot of all currently registered tools across all sources
   * (built-in, Tier 2, and MCP).
   */
  listTools(): Promise<ToolDescriptor[]>;
}
```

**Usage:**

```typescript
import type { IToolsService, ManifestTool, ToolHandler } from 'asyar-sdk/contracts';

// In your worker entry point:
const tools = context.getService<IToolsService>('tools');

const descriptor: ManifestTool = {
  id: 'lookup-contact',
  name: 'Lookup Contact',
  description: 'Search the contacts database by name and return matching entries.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name to search for' },
    },
    required: ['query'],
  },
};

const handler: ToolHandler = async (args) => {
  const { query } = args as { query: string };
  // ... perform the lookup ...
  return { contacts: [] };
};

await tools.registerTool(descriptor, handler);

// Inspect all available tools (from all sources):
const all = await tools.listTools();

// Remove the tool when it is no longer relevant:
await tools.unregisterTool('lookup-contact');
```

**How it works under the hood:**

The SDK proxy (`ToolsServiceProxy`) keeps a local `handlers` map keyed by tool id. `registerTool` stores the handler in that map, then sends `tools:registerTool` to the launcher via the IPC broker. The launcher's `ExtensionIpcRouter` validates the permission and forwards the call to the Rust `agents_tools_register_tier2` Tauri command.

On the Rust side, `ToolRegistry.register_tier2` applies a replace-style update: all entries previously stored under your `extensionId` are dropped and replaced by the new list. The Rust registry assigns each tool its `fullyQualifiedId` in the form `<extensionId>:<toolId>` (e.g. `org.asyar.contacts:lookup-contact`).

When an agent invokes one of your tools, the call flows back in the other direction: agent → Rust registry → launcher → `tools:invokeHandler` postMessage → `ToolsServiceProxy.invokeHandler` → the `ToolHandler` you registered. The result is returned to the agent as a serialised JSON value.

`unregisterTool` removes the handler from the local map and posts `tools:unregisterTool` to the launcher, which re-runs the replace-style registration with the tool excluded.

**Placement guidance:**

`ToolsService` is exposed only in the worker proxy bag (see [ExtensionRuntime](../../explanation/extension-runtime.md) for the worker/view split). Attempting to call it from the view bundle will fail at module load with a role-assertion error.

Tool ids must not contain a colon (`:`). The Rust registry rejects any id that does because the colon is used as the separator in the fully-qualified id format. Use short, lowercase, hyphenated identifiers (e.g. `lookup-contact`, not `contacts:lookup`).

---
