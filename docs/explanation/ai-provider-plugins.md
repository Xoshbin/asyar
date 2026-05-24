---
order: 14
---
# AI Provider Plugins — How Tool Calling Stays Provider-Agnostic

This page is for launcher contributors and forkers. Extension authors interact with the AI surface through a different surface — see [AI Service — SDK reference](../reference/sdk/ai-service.md) for that. You only need this page if you are adding a new provider, modifying an existing one, or trying to understand why the agent loop does not contain any provider-specific branching.

## The problem this design solves

Asyar supports six AI providers: OpenAI, Anthropic, Google Gemini, Ollama, OpenRouter, and a user-supplied Custom endpoint. Each of these has a different HTTP API, different auth headers, different message serialisation formats, different tool-calling conventions, and different SSE stream framing. The agent loop — the code that drives multi-turn conversations, dispatches tool calls to extensions, and collects results — has to work with all of them without caring which one the user has selected.

The solution is a plugin registry. Every provider is a plain TypeScript object that implements `IProviderPlugin`. The agent loop talks only to that interface. Each provider object translates between the interface's normalised types and its own wire format. Adding a seventh provider means adding one file and one registration line.

## The contract — `IProviderPlugin`

The interface is defined in `src/services/ai/IProviderPlugin.ts`. Every provider must satisfy it exactly:

```typescript
export interface IProviderPlugin {
  readonly id: ProviderId;
  readonly name: string;
  readonly requiresApiKey: boolean;
  readonly optionalApiKey?: boolean;
  readonly requiresBaseUrl: boolean;
  readonly supportsTools: true;

  getModels(config: ProviderConfig): Promise<ModelInfo[]>;
  buildRequest(messages: ChatMessage[], config: ProviderConfig, params: ChatParams): RequestSpec;
  parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<string>;

  buildToolRequest(
    messages: LoopMessage[],
    config: ProviderConfig,
    params: ChatParams,
    tools: Array<{ id: string; name: string; description: string; parameters: Record<string, unknown> }>,
  ): RequestSpec;

  parseToolStream(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<ToolStreamEvent>;
}
```

Field by field:

- **`id`** — a `ProviderId` literal (`'openai' | 'anthropic' | 'google' | 'ollama' | 'openrouter' | 'custom'`). Used as the registry key and persisted in user settings.
- **`name`** — the display string shown in the settings UI.
- **`requiresApiKey`** — `true` if the provider refuses requests without a key. Anthropic, OpenAI, Google, and OpenRouter require one. Ollama and Custom do not (Ollama is typically local; Custom may or may not be secured).
- **`optionalApiKey`** — when `true`, the UI renders an optional key field that is submitted if present but not required. Only the `custom` provider uses this today.
- **`requiresBaseUrl`** — `true` when the user must supply the server root (Ollama and Custom). `false` when the endpoint is fixed and known (the three cloud providers).
- **`supportsTools`** — must be the literal `true`, not just any `boolean`. See the registry guard section below.
- **`getModels(config)`** — fetches the list of available models given the user's current provider config. Returns `ModelInfo[]` (an `{ id, label }` pair). Permitted to return `[]` on error; the UI falls back to a manual text input.
- **`buildRequest(messages, config, params)`** — builds the `RequestSpec` (URL, headers, body) for a plain streaming chat turn. `ChatMessage[]` carries the full conversation history in the launcher's internal format.
- **`parseStream(reader)`** — parses the provider's SSE stream for a plain chat response. Yields plain `string` tokens as they arrive.
- **`buildToolRequest(messages, config, params, tools)`** — builds the `RequestSpec` for a tool-capable turn. Receives `LoopMessage[]` (a superset of `ChatMessage` that includes tool-result messages and assistant turns that called tools) plus the full list of available tool descriptors. Returns a `RequestSpec`.
- **`parseToolStream(reader)`** — parses the SSE stream from a tool-capable response. Yields `ToolStreamEvent` objects.

## What `ToolStreamEvent` looks like

`ToolStreamEvent` is defined alongside `IProviderPlugin` in `src/services/ai/IProviderPlugin.ts`:

```typescript
export type ToolStreamEvent =
  | { type: 'text'; text: string }
  | ({ type: 'tool_use' } & ToolCall)
  | { type: 'message_stop' };
```

Where `ToolCall` is:

```typescript
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}
```

Every `parseToolStream` implementation must produce this same shape regardless of what the wire format looks like. A `text` event carries a streamed text token. A `tool_use` event carries a fully-assembled tool call — the provider is responsible for accumulating any argument fragments across multiple SSE chunks and emitting only when the call is complete. A `message_stop` event signals that the turn is done. The agent loop never reads anything provider-specific from these events.

## What each plugin owns

A provider plugin has three responsibilities.

**Request shaping.** `buildRequest` and `buildToolRequest` own the translation from the launcher's internal message types to whatever JSON body the provider expects. This is where Anthropic's `tool_use` content blocks, Google's `functionDeclarations`, and OpenAI's `tools` array come from. It is also where auth headers are assembled. The result is a `RequestSpec` — just a URL, a headers map, and an opaque body. The launcher's HTTP layer issues the fetch without inspecting the body.

**Stream parsing.** `parseStream` and `parseToolStream` own the translation from raw SSE bytes to normalised events. This includes all the edge cases: argument fragments spread across multiple delta events (OpenAI), `content_block_start` / `content_block_stop` framing (Anthropic), double-newline event separators (Google), newline-delimited JSON objects (Ollama). Callers see only the normalised stream and never touch the provider's framing.

**Tool serialisation.** Each provider uses a different JSON shape to represent a tool in a request and a different signal to identify tool calls in a response. Anthropic uses `input_schema` keyed by `name` (not `id`). Google uses `functionDeclarations` with `parameters` directly. OpenAI uses `function` objects with JSON Schema under `parameters`. Ollama mirrors the OpenAI shape for the request but emits tool calls as fully-parsed JSON objects in the response rather than stringified JSON fragments. Mapping between the launcher's `{ id, name, description, parameters }` descriptor and these shapes is entirely the plugin's business.

## The registry guard

`src/services/ai/providerRegistry.ts` enforces three conditions at registration time:

```typescript
export function registerProvider(plugin: IProviderPlugin): void {
  if (typeof plugin.buildToolRequest !== 'function') {
    throw new Error(`registerProvider: plugin "${plugin.id}" is missing required method buildToolRequest`);
  }
  if (typeof plugin.parseToolStream !== 'function') {
    throw new Error(`registerProvider: plugin "${plugin.id}" is missing required method parseToolStream`);
  }
  if (plugin.supportsTools !== true) {
    throw new Error(`registerProvider: plugin "${plugin.id}" must declare supportsTools: true`);
  }
  registry.set(plugin.id, plugin);
}
```

If any of these fail, the `initProviders()` call in app startup throws and the provider is not added to the registry.

The `supportsTools: true` literal-true type serves two purposes. At the TypeScript level it narrows `supportsTools` to the singleton `true` rather than `boolean`, which lets callers check `plugin.supportsTools` and have the compiler confirm the plugin is tool-capable without a type assertion. At runtime, the strict `!== true` check in the guard ensures that a plugin that sets `supportsTools: false` or omits the field is rejected even if the types somehow passed — for example if a plugin is added in plain JavaScript or assembled dynamically.

The guard is the reason you can never partially implement the tool-calling interface. A provider that only wants to support plain chat still has to implement `buildToolRequest` and `parseToolStream` — the contract is all-or-nothing.

## The shared OpenAI-compat helper

Four of the six providers share the same wire format for tool calls: the OpenAI Chat Completions `tools` array shape, with arguments serialised as a JSON string in the function call delta, accumulated by index across multiple SSE chunks. Rather than repeating that logic, these providers delegate to `src/services/ai/providers/_openaiCompat.ts`.

The helper exports three things:

- **`buildOpenAIToolsBody(messages, params, tools)`** — builds the complete request body, including converting `LoopMessage[]` (with tool-result messages in the `tool` role and `tool_call_id` references) to the OpenAI messages array.
- **`parseOpenAIToolStream(reader)`** — parses the SSE stream, accumulates argument fragments keyed by delta `index`, and emits fully-assembled `tool_use` events when `finish_reason: 'tool_calls'` arrives.
- **`openAIToolsMessages(messages)`** — the message-conversion step extracted separately, used by `buildOpenAIToolsBody` internally.

Providers that delegate to the helper:

| Provider | `buildToolRequest` | `parseToolStream` |
|---|---|---|
| `openai` | delegates via `buildOpenAIToolsBody` | delegates via `parseOpenAIToolStream` |
| `openrouter` | delegates via `buildOpenAIToolsBody` | delegates via `parseOpenAIToolStream` |
| `custom` | delegates via `buildOpenAIToolsBody` | delegates via `parseOpenAIToolStream` |
| `ollama` | delegates via `buildOpenAIToolsBody` | **implements its own** |

Ollama's `buildToolRequest` uses the OpenAI body format because Ollama's `/api/chat` endpoint accepts OpenAI-shaped tool declarations. However, Ollama's `parseToolStream` is implemented directly in `ollama.ts` rather than delegating to the helper. Ollama emits tool calls as already-parsed JSON objects in the response body, not as stringified JSON fragments spread across delta chunks — the accumulation logic in `parseOpenAIToolStream` does not apply, and delegating to it would silently produce empty `input` objects.

`anthropic` and `google` implement all four methods themselves. Anthropic's wire format (`tool_use` content blocks, `input_json_delta` fragments, `content_block_stop` completion signals) is entirely different from OpenAI's. Google's Gemini format (`functionDeclarations`, `functionCall` parts, `functionResponse` replies) is similarly distinct.

## Recipe — adding a 7th provider

**1. Create the plugin file.**

Add `src/services/ai/providers/<name>.ts`. The file exports a single `const <name>Plugin: IProviderPlugin = { ... }` object.

If the provider's wire format is OpenAI-compatible for tool calls, import from `_openaiCompat.ts` and delegate:

```typescript
import { buildOpenAIToolsBody, parseOpenAIToolStream } from './_openaiCompat';

buildToolRequest(messages, config, params, tools) {
  const body = buildOpenAIToolsBody(messages, params, tools);
  return { url: '...', headers: { ... }, body: JSON.stringify(body) };
},

parseToolStream(reader) {
  return parseOpenAIToolStream(reader);
},
```

If the provider uses its own format, implement `buildToolRequest` and `parseToolStream` directly. Look at `anthropic.ts` for a model that handles content blocks with accumulation, or `google.ts` for one that maps `functionCall` parts. Document rate limits, auth header names, and model list endpoints as comments in the plugin file itself — that is the right home for provider-specific operational details.

**2. Register the plugin.**

Add one line to `src/services/ai/initProviders.ts`:

```typescript
import { <name>Plugin } from './providers/<name>';
// ...
registerProvider(<name>Plugin);
```

**3. Update the `ProviderId` union.**

Add `'<name>'` to the `ProviderId` type in `src/services/ai/IProviderPlugin.ts`.

**4. Nothing else.**

The agent loop in `src/built-in-features/agents/agentLoop.ts` calls `getProvider(id)` and then calls `buildToolRequest` and `parseToolStream` on whatever it gets back. No switch statements, no provider-specific branches. If the registry guard passes, the loop will work with the new provider on the next agent run.

## Cross-references

- [Run Tracking](./run-tracking.md) — where the run created by an agent's tool loop ends up; how tool-call turns translate to run state transitions.
- [AI Service — SDK reference](../reference/sdk/ai-service.md) — the extension-author-facing surface; what Tier 2 extensions call when they want to invoke AI from their own code.
- [Tools Service — SDK reference](../reference/sdk/tools-service.md) — how extensions register tools that the agent loop can discover and call; the other side of the `tools` array that `buildToolRequest` receives.
- [Extension Runtime](./extension-runtime.md) — worker/view split context; why long-running agent turns must be anchored to the worker iframe.
