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
import { context } from 'asyar-sdk';

// Register the search handler matching the manifest id "keenable"
const unregister = context.ai.registerWebSearchEngine({
  id: 'keenable',
  async search(query, signal) {
    const response = await fetch(
      `https://api.keenable.example/search?q=${encodeURIComponent(query.query)}&limit=${query.limit}`,
      {
        headers: {
          Authorization: `Bearer ${query.apiKey}`,
        },
        signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Search provider failed with status ${response.status}`);
    }

    const data = await response.json();

    return {
      sources: data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
      })),
      results: data.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      })),
    };
  },
});
```

---
