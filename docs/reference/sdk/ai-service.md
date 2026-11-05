### 8.39 `AiService` — Prompt the host's configured AI model

**Runs in:** both worker and view.

**Permission required:** `ai`.

`AiService` provides Tier 2 extensions with programmatic access to prompt the user's currently configured AI model without requiring direct provider credentials, API keys, or custom provider configuration. The host routes requests through Asyar's default agent runtime.

```typescript
export interface AiCompletionOptions {
  /** Optional system prompt to steer model behavior. */
  systemPrompt?: string;
  /** Sampling temperature between 0.0 and 2.0. */
  temperature?: number;
  /** Maximum number of tokens to generate. */
  maxTokens?: number;
  /** Abort signal to cancel the request. */
  signal?: AbortSignal;
}

export interface AiStreamOptions extends AiCompletionOptions {
  /** Optional stream identifier for debugging/tracking. */
  streamId?: string;
}

export interface IAiService {
  /**
   * Prompts the configured AI model for a one-shot completion.
   *
   * @param prompt - The user prompt text.
   * @param options - Optional completion options (temperature, systemPrompt, signal, etc.).
   * @returns The generated response text.
   */
  complete(prompt: string, options?: AiCompletionOptions): Promise<string>;

  /**
   * Prompts the configured AI model and streams text chunks as they arrive.
   *
   * @param prompt - The user prompt text.
   * @param onChunk - Callback invoked with each incoming chunk.
   * @param options - Optional stream options including AbortSignal.
   * @returns The complete accumulated response text.
   */
  stream(
    prompt: string,
    onChunk: (chunk: string) => void,
    options?: AiStreamOptions,
  ): Promise<string>;
}
```

**Manifest Declaration:**

```json
{
  "permissions": ["ai"]
}
```

**Usage (One-shot completion):**

```typescript
import type { IAiService } from 'asyar-sdk/contracts';

const ai = context.getService<IAiService>('ai');

const response = await ai.complete('Summarize this text in 3 bullet points: ...', {
  systemPrompt: 'You are an executive assistant focusing on actionable items.',
  temperature: 0.3,
});
console.log(response);
```

**Usage (Streaming with cancellation):**

```typescript
import type { IAiService } from 'asyar-sdk/contracts';

const ai = context.getService<IAiService>('ai');
const controller = new AbortController();

try {
  const fullText = await ai.stream(
    'Draft a release announcement for version 1.2.0',
    (chunk) => {
      process.stdout.write(chunk);
    },
    {
      signal: controller.signal,
      temperature: 0.7,
    },
  );
} catch (err) {
  if (err instanceof Error && err.name === 'AbortError') {
    console.log('Stream was cancelled');
  } else {
    throw err;
  }
}
```

**Security & Permission Gating:**

- **Manifest Permission:** The extension must declare `"ai"` in its manifest permissions (`manifest.json["permissions"]`). Calling `complete()` or `stream()` without declaring `"ai"` is blocked by Asyar's fail-closed permission gate and returns an `AppError::Permission` error.
- **Privacy & Redaction:** Prompts dispatched through `AiService` automatically flow through Asyar's host secret-redaction pipeline, preventing accidental leakage of credentials (AWS keys, tokens, private keys) to upstream AI providers.

---

### Web Search Engine SPI

**Runs in:** worker only.

**Permissions required:** `ai:web-search` and `network`.

`AiService` also hosts the **Web Search Engine Service Provider Interface (SPI)**, which allows Tier 2 extensions to contribute search engines (such as Keenable, Exa, Kagi, or custom self-hosted endpoints) to Asyar.

When an extension contributes a search engine:

1. It appears dynamically in **Settings → AI → Web Search** alongside built-in neutral fallbacks (DuckDuckGo, SearXNG).
2. Any required or optional API keys and base URLs are configured in Settings and stored encrypted in Asyar's credential vault.
3. When the built-in search tool (`builtin:web-search`) is invoked during an AI conversation, queries are dispatched over IPC to the extension's registered worker handler.
4. Normalized results (`sources` and `results`) render directly in the Chat UI with native status streaming, source pills, and favicons.

#### Types & Contracts

```typescript
export interface GroundingSource {
  title: string;
  url: string;
}

export interface SearchResultEntry {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResult {
  sources: GroundingSource[];
  results: SearchResultEntry[];
}

export interface WebSearchQuery {
  query: string;
  limit: number;
  apiKey?: string;
  baseUrl?: string;
}

export type WebSearchHandler = (
  query: WebSearchQuery,
  signal: AbortSignal,
) => Promise<WebSearchResult>;

export interface WebSearchEngineRegistration {
  id: string;
  search: WebSearchHandler;
}
```

#### Example Manifest

```json
{
  "id": "org.example.keenable",
  "name": "Keenable Search",
  "version": "1.0.0",
  "permissions": ["network", "ai:web-search"],
  "background": { "main": "dist/worker.js" },
  "webSearchEngines": [
    {
      "id": "keenable",
      "name": "Keenable Search",
      "description": "High-signal web search for AI agents",
      "homepage": "https://keenable.example",
      "requiresApiKey": true,
      "apiKeyPlaceholder": "knb-...",
      "apiKeyHelpUrl": "https://keenable.example/docs/api"
    }
  ]
}
```

#### Example Worker Registration (`src/worker.ts`)

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { INetworkService, WebSearchQuery, WebSearchResult } from 'asyar-sdk/contracts';

export default class KeenableExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    const network = context.getService<INetworkService>('network');

    // Register the search handler matching the manifest id "keenable"
    context.ai.registerWebSearchEngine({
      id: 'keenable',
      async search(query: WebSearchQuery, signal: AbortSignal): Promise<WebSearchResult> {
        const response = await network.fetch(
          `https://api.keenable.example/search?q=${encodeURIComponent(query.query)}&limit=${query.limit}`,
          {
            headers: {
              Authorization: `Bearer ${query.apiKey ?? ''}`,
              Accept: 'application/json',
            },
          },
        );

        if (!response.ok) {
          throw new Error(`Search provider failed with status ${response.status}`);
        }

        const data = JSON.parse(response.body);

        return {
          sources: (data.results ?? []).map((r: any) => ({
            title: r.title,
            url: r.url,
          })),
          results: (data.results ?? []).map((r: any) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet ?? '',
          })),
        };
      },
    });
  }
}
```

---

### AI Model & Inference Provider SPI

**Runs in:** worker only.

**Permissions required:** `ai:provider` and `network`.

`AiService` also hosts the **AI Model & Inference Provider Service Provider Interface (SPI)**, which allows Tier 2 extensions to contribute custom LLM inference engines and model catalogs (such as Groq, Mistral, Cohere, DeepSeek, SambaNova, or local self-hosted endpoints) to Asyar.

When an extension contributes an AI provider:

1. It appears dynamically in **Settings → AI** alongside built-in providers in the **+ Add Provider** menu.
2. Required or optional API keys, base URLs, and custom placeholders are rendered in Settings and stored encrypted in Asyar's local credential vault.
3. Users can configure instances of the provider and select them for the default agent or custom user-defined agents.
4. When an agent run executes, requests are dispatched over IPC to the extension worker's registered `completeStream` handler. Chunks (`token`, `tool_call`, `status`) stream back in real time and are seamlessly merged into the conversation with full cancellation support.
5. If the extension implements `listModels()`, clicking **Test & Fetch Models** dynamically loads the provider's remote model catalog into the searchable model selector.

#### Types & Contracts

```typescript
export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AiMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: AiToolCall[];
  toolCallId?: string;
}

export interface AiToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  modelId: string;
  temperature?: number;
  maxTokens: number;
  systemPrompt?: string;
  tools?: AiToolDefinition[];
  apiKey?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export type AiStreamChunk =
  | { type: 'token'; token: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'status'; status: string };

export interface AiModelInfo {
  id: string;
  label: string;
  contextWindow?: number;
  reasoningEfforts?: string[];
}

export interface AiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
}

export type AiStreamCallback = (chunk: AiStreamChunk) => void;

export type AiProviderCompleteStream = (
  request: AiCompletionRequest,
  onChunk: AiStreamCallback,
  signal: AbortSignal,
) => Promise<void>;

export type AiProviderListModels = (
  config: AiProviderConfig,
  signal: AbortSignal,
) => Promise<AiModelInfo[]>;

export interface AiProviderRegistration {
  /** Must match an id declared in manifest.aiProviders */
  id: string;
  /** Streaming completion handler executed in the extension worker */
  completeStream: AiProviderCompleteStream;
  /** Optional dynamic model discovery handler */
  listModels?: AiProviderListModels;
}
```

#### Example Manifest (`manifest.json`)

```json
{
  "id": "org.example.groq",
  "name": "Groq Provider",
  "version": "1.0.0",
  "permissions": ["network", "ai:provider"],
  "background": { "main": "dist/worker.js" },
  "aiProviders": [
    {
      "id": "groq",
      "name": "Groq",
      "description": "Ultra-fast LPU inference for open models",
      "homepage": "https://groq.com",
      "requiresApiKey": true,
      "apiKeyPlaceholder": "gsk_...",
      "apiKeyHelpUrl": "https://console.groq.com/keys",
      "models": [
        {
          "id": "llama-3.3-70b-versatile",
          "name": "Llama 3.3 70B Versatile",
          "contextWindow": 128000
        }
      ]
    }
  ]
}
```

#### Example Worker Registration (`src/worker.ts`)

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type {
  AiCompletionRequest,
  AiProviderConfig,
  AiStreamCallback,
  AiModelInfo,
} from 'asyar-sdk/contracts';

export default class GroqExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    context.ai.registerAiProvider({
      id: 'groq',
      async completeStream(
        request: AiCompletionRequest,
        onChunk: AiStreamCallback,
        signal: AbortSignal,
      ): Promise<void> {
        const response = await fetch(
          request.baseUrl ?? 'https://api.groq.com/openai/v1/chat/completions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${request.apiKey ?? ''}`,
              'Content-Type': 'application/json',
              ...(request.customHeaders ?? {}),
            },
            body: JSON.stringify({
              model: request.modelId,
              messages: request.messages,
              temperature: request.temperature,
              max_tokens: request.maxTokens,
              stream: true,
            }),
            signal,
          },
        );

        if (!response.ok || !response.body) {
          throw new Error(`Groq stream failed with status ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            if (trimmed.startsWith('data: ')) {
              const parsed = JSON.parse(trimmed.slice(6));
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                onChunk({ type: 'token', token });
              }
            }
          }
        }
      },

      async listModels(config: AiProviderConfig, signal: AbortSignal): Promise<AiModelInfo[]> {
        const response = await fetch(config.baseUrl ?? 'https://api.groq.com/openai/v1/models', {
          headers: {
            Authorization: `Bearer ${config.apiKey ?? ''}`,
            ...(config.customHeaders ?? {}),
          },
          signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to list models: ${response.status}`);
        }
        const data = await response.json();
        return (data.data ?? []).map((m: any) => ({
          id: m.id,
          label: m.id,
        }));
      },
    });
  }
}
```

---

### Web Reader SPI

Extensions with the `ai:web-reader` and `network` permissions can contribute custom web content scrapers and Markdown readers for AI agent tools by declaring `webReaders` in their `manifest.json` and registering the engine handler in their background worker.

#### Interface

```typescript
export interface WebReaderQuery {
  url: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface WebReaderResult {
  url: string;
  title?: string;
  content: string;
  status?: number;
  metadata?: Record<string, unknown>;
}

export type WebReaderHandler = (
  query: WebReaderQuery,
  signal: AbortSignal,
) => Promise<WebReaderResult>;

export interface WebReaderEngineRegistration {
  id: string;
  read: WebReaderHandler;
}

// On context.ai:
registerWebReader(engine: WebReaderEngineRegistration): () => void;
```

#### Example Manifest (`manifest.json`)

```json
{
  "id": "org.example.jina",
  "name": "Jina Reader",
  "version": "1.0.0",
  "permissions": ["network", "ai:web-reader"],
  "background": { "main": "dist/worker.js" },
  "webReaders": [
    {
      "id": "jina-reader",
      "name": "Jina Reader",
      "description": "Extracts clean Markdown from any URL with SPA rendering.",
      "homepage": "https://jina.ai/reader",
      "requiresApiKey": false,
      "apiKeyOptional": true,
      "apiKeyPlaceholder": "jina_...",
      "apiKeyHelpUrl": "https://jina.ai",
      "requiresBaseUrl": false
    }
  ]
}
```

#### Example Worker Registration (`src/worker.ts`)

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { INetworkService, WebReaderQuery, WebReaderResult } from 'asyar-sdk/contracts';

export default class JinaReaderExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    const network = context.getService<INetworkService>('network');

    // Register reader handler matching the manifest id "jina-reader"
    context.ai.registerWebReader({
      id: 'jina-reader',
      async read(query: WebReaderQuery, signal: AbortSignal): Promise<WebReaderResult> {
        const headers: Record<string, string> = { Accept: 'text/markdown, text/plain' };
        if (query.apiKey) {
          headers.Authorization = `Bearer ${query.apiKey}`;
        }
        const response = await network.fetch(`https://r.jina.ai/${query.url}`, {
          headers,
        });

        if (!response.ok) {
          throw new Error(`Reader provider failed with status ${response.status}`);
        }

        return {
          url: query.url,
          content: response.body,
          status: response.status,
        };
      },
    });
  }
}
```

      },
    });

}
}

```

---
```
