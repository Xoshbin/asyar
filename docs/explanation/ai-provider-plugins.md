---
order: 14
---

# AI Providers and the Rust Agent Runtime

Asyar supports OpenAI, Anthropic, Google Gemini, Ollama, OpenRouter, and custom OpenAI-compatible endpoints. Provider execution is intentionally owned by Rust. The frontend only renders provider settings, starts a run, and displays typed stream events.

## Ownership boundary

Rust owns:

- provider request construction and authentication headers;
- model discovery, filtering, and reasoning-capability metadata;
- SSE and newline-delimited stream parsing;
- conversation history and multi-turn loop state;
- builtin and MCP tool execution;
- persistence, cancellation, timeouts, and thread-title derivation.

TypeScript owns:

- static labels and fields required to render provider settings;
- forwarding provider configuration to typed Tauri commands;
- rendering agent stream events;
- the browser bridge for Tier 2 extension tools, which Rust cannot execute directly.

The display descriptors in `src/services/ai/initProviders.ts` contain no provider protocol logic. Their `getModels` method delegates to `ai_list_models`; the implementation and response normalization live in `src-tauri/src/ai/models.rs`.

## Agent execution flow

`agents_run_thread` and `agents_run_silent` enter the shared Rust runner in `src-tauri/src/agents/runner.rs`. The runner calls the provider implementation in `src-tauri/src/ai`, consumes normalized stream events, persists state when appropriate, and continues until the model produces a final response.

Tool ownership is resolved in Rust:

- builtin tools execute in Rust;
- MCP tools execute through the Rust MCP supervisor, including permission decisions;
- Tier 2 extension tools suspend the runner and emit a typed `toolDispatch` event.

For a Tier 2 tool, the frontend invokes the owning extension iframe and reports the result with `agents_report_tool_result`. A bounded Rust oneshot wait then resumes the same runner. The frontend never advances the conversation or creates the next provider request.

## Adding a provider

Adding a provider requires Rust implementation and tests first:

1. Add its request shaping and stream parsing to `src-tauri/src/ai/providers.rs`.
2. Add model discovery request and response handling to `src-tauri/src/ai/models.rs`.
3. Cover request serialization, stream normalization, tool calls, and model metadata with Rust tests.
4. Add only the provider's display metadata to `src/services/ai/initProviders.ts`.
5. Extend the `ProviderId` union used by settings.

Provider-specific algorithms, retry policies, and stream accumulators must not be added to TypeScript.

## Extension boundary

Extensions can register agent tools through [`ToolsService`](../reference/sdk/tools-service.md). Asyar does not expose the user's AI provider as a general extension service. This keeps credentials, quota-consuming requests, and agent policy inside the host-owned Rust runtime.

## Cross-references

- [Tools Service](../reference/sdk/tools-service.md)
- [Extension Runtime](./extension-runtime.md)
- [IPC Bridge](./ipc-bridge.md)
- [Run Tracking](./run-tracking.md)
