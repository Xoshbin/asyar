---
order: 5
---
## Register Extension Tools for the Agent Runtime

Asyar's agent runtime can invoke tools contributed by any enabled Tier 2 extension. The agent sees your tools alongside built-in tools (calculator, clipboard, shell, etc.) and MCP-sourced tools. This page walks through declaring tools in the extension manifest and registering handlers from the worker so the agent can call them.

---

### Step 1 — Declare the permission and the tools array in `manifest.json`

Add `"tools:register"` to your `permissions` array and list every tool your extension contributes under a top-level `tools` field.

```json
// manifest.json
{
  "id": "org.example.contacts",
  "name": "Contacts",
  "version": "1.0.0",
  "permissions": ["tools:register"],
  "background": { "main": "dist/worker.js" },
  "commands": [
    {
      "id": "open-contacts",
      "name": "Open Contacts",
      "mode": "view",
      "component": "ContactsView"
    }
  ],
  "tools": [
    {
      "id": "lookup-contact",
      "name": "Lookup Contact",
      "description": "Search the contacts database by name and return matching entries.",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Name to search for" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

**`id` constraints:**
- Cannot contain a colon (`:`). The Rust registry rejects any tool id with a colon because colons are used as the separator in fully-qualified ids (e.g. `org.example.contacts:lookup-contact`). Use hyphens or dots instead.
- Must be unique within your extension. Duplicate ids cause the second declaration to silently overwrite the first inside the replace-style registry update.

**`parameters`** is a raw JSON Schema object. There is no wrapper — pass the schema object directly (not wrapped in `{schema: ...}`).

The manifest `tools` field seeds the Rust `ToolRegistry` at startup and whenever the extension is enabled or disabled. Declaring a tool in the manifest does not register its handler — that happens from the worker (Step 2).

---

### Step 2 — Register the handler from the worker

Obtain `IToolsService` from the worker context and call `registerTool` for each tool. Do this at worker startup, before any agent invocation can reach the tool.

```typescript
// src/main.worker.ts
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { IToolsService, ManifestTool, ToolHandler } from 'asyar-sdk/contracts';

export async function main(context: ExtensionContext): Promise<void> {
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
    // Perform the lookup against your data source.
    const results = await performLookup(query);
    return { contacts: results };
  };

  await tools.registerTool(descriptor, handler);
}
```

**Handler signature:** `(args: unknown) => Promise<unknown>`. The `args` value is the object the agent provided — cast it to the shape your `parameters` schema describes. The return value must be JSON-serialisable; the launcher forwards it to the LLM as a tool result.

**Worker-only placement:** `IToolsService` is in the worker proxy bag. The view bundle does not expose it, and attempting to resolve it from a view entry point fails at module load. Register handlers in `main.worker.ts` (or equivalent), not in any view file.

If you register from the worker and the descriptor's `id` matches what is declared in the manifest, the launcher links the incoming agent invocation to your handler. If the handler is not registered, the invocation returns an error to the agent.

---

### Step 3 — Lifecycle

**On enable:** The Rust registry seeds your extension's tools from the manifest at the same time as the worker iframe is mounted. The launcher calls `register_tier2` with the full `tools` list from your manifest.

**On disable:** `unregister_tier2` is called immediately. Your tools disappear from agent tool listings before the worker is torn down.

**On uninstall:** Same as disable — `unregister_tier2` runs as part of the uninstall cleanup path.

**On launcher restart:** Previously-enabled extensions are restored from `settings.dat` without `set_enabled` being called. The launcher runs a startup seed (`run_tool_registry_seed_for_enabled_extensions`) that walks every enabled, non-built-in extension and re-registers their manifest tools. Your handlers are re-registered when the worker iframe is remounted.

Because the registry is always rebuilt replace-style from the manifest declaration, removing a tool from the manifest and restarting (or toggling the extension off and on) is sufficient to deregister it.

See [Extension Runtime](../explanation/extension-runtime.md) for the worker lifecycle state machine (`Dormant → Mounting → Ready → Degraded`) that governs iframe materialisation.

---

### Verifying it worked

1. Enable the extension in Asyar.
2. Open an agent's edit view.
3. In the tool picker, locate your extension's group. Your tool should appear as a checkbox row under your extension's name.
4. Enable the tool in the picker, save the agent, and send a prompt that matches the tool's description.
5. The agent should emit a tool-use block, your handler should run, and a tool-result bubble should appear in the chat.

The [agent-runtime manual-test scenarios](../manual-tests/agent-runtime.md) (scenarios 6–8) describe the full tool-calling end-to-end flow and are the authoritative QA checklist for this feature.

---

### Common pitfalls

**Tool id contains a colon.**
The Rust registry rejects any tool id with `:`. Use hyphens (`lookup-contact`) or dots (`lookup.contact`), not `contacts:lookup`.

**Handler registered after the agent has already invoked the tool.**
If `registerTool` is called lazily (e.g. in response to a user action rather than at worker startup), the handler may not be present when the agent calls it. Register all handlers unconditionally in the worker entry point, at startup.

**Handler errors propagate to the agent as strings.**
Unhandled exceptions in a handler are caught by the launcher and returned to the LLM as an error string. If you want the agent to receive structured error information (e.g. `{error: "not_found", id: "..."}`) rather than an exception message, catch the error yourself and return a structured object.

**Registering tools from the view bundle.**
`IToolsService` is not available in the view proxy bag. Calls to `context.getService<IToolsService>('tools')` from view code fail at module load with a role-assertion error. Move all tool registration to the worker.

**Permission not declared.**
Without `"tools:register"` in the manifest `permissions` array, every `tools:registerTool` IPC call is blocked by the permission gate and returns a permission-denied error. The tool will never appear in the agent tool picker.

**`parameters` wrapped in an extra object.**
Pass the JSON Schema object directly to `parameters`, not wrapped in a container. The agent runtime passes the schema to the LLM verbatim; an incorrectly shaped schema may cause the LLM to call the tool with malformed arguments.

---

For the full SDK reference — including `unregisterTool`, `listTools`, and the `ToolDescriptor` shape — see [ToolsService SDK Reference](../reference/sdk/tools-service.md).
