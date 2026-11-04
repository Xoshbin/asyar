---
order: 6
---

## Contribute a Web Search Engine to Asyar

Asyar features an extensible **Web Search Engine SPI (Service Provider Interface)** that allows Tier 2 extensions to contribute web search providers to Asyar's built-in AI agent.

When an extension contributes a web search engine:

- It appears automatically in **Settings → AI → Web Search**.
- If your provider requires an API key or custom endpoint URL, Asyar renders the credential configuration fields and stores the keys encrypted on device.
- During AI conversations, Asyar's agent runner (`builtin:web-search`) dispatches queries to your extension worker over IPC.
- Returned citations and snippets seamlessly render in the Chat UI with real-time status streaming, domain favicons, and interactive source pills.

---

### Step 1 — Declare `webSearchEngines` in `manifest.json`

Add `"network"` and `"ai:web-search"` to your `permissions` array, declare a background worker via `background.main`, and define your engine under `webSearchEngines`:

```json
{
  "id": "org.example.keenable",
  "name": "Keenable Search",
  "version": "1.0.0",
  "permissions": ["network", "ai:web-search"],
  "background": {
    "main": "dist/worker.js"
  },
  "webSearchEngines": [
    {
      "id": "keenable",
      "name": "Keenable Search",
      "description": "High-signal web search designed for AI agent grounding.",
      "homepage": "https://keenable.example",
      "requiresApiKey": true,
      "apiKeyPlaceholder": "knb-...",
      "apiKeyHelpUrl": "https://keenable.example/docs/api-keys"
    }
  ]
}
```

#### Manifest Fields Reference

| Field                | Type      | Required | Description                                                          |
| -------------------- | --------- | -------- | -------------------------------------------------------------------- |
| `id`                 | `string`  | ✅       | Short engine identifier (must match `/^[a-z0-9_-]{1,64}$/`).         |
| `name`               | `string`  | ✅       | Display label shown in the Settings dropdown.                        |
| `description`        | `string`  | ❌       | Subtitle / description displayed in Settings.                        |
| `homepage`           | `string`  | ❌       | Project or documentation homepage (`http://` or `https://`).         |
| `requiresApiKey`     | `boolean` | ❌       | Prompt for a required API key in Settings.                           |
| `apiKeyOptional`     | `boolean` | ❌       | Prompt for an optional API key in Settings.                          |
| `apiKeyPlaceholder`  | `string`  | ❌       | Custom placeholder text for the API key input.                       |
| `apiKeyHelpUrl`      | `string`  | ❌       | Link for the user to obtain an API key (`http://` or `https://`).    |
| `requiresBaseUrl`    | `boolean` | ❌       | Prompt for a custom endpoint URL (useful for self-hosted instances). |
| `baseUrlPlaceholder` | `string`  | ❌       | Custom placeholder for the endpoint URL input.                       |

---

### Step 2 — Register the search handler in your worker

In your background entrypoint (`src/worker.ts`), register your handler using `context.ai.registerWebSearchEngine` inside your extension's `initialize` method:

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { INetworkService, WebSearchQuery, WebSearchResult } from 'asyar-sdk/contracts';

export default class KeenableExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    const network = context.getService<INetworkService>('network');

    context.ai.registerWebSearchEngine({
      id: 'keenable',
      async search(query: WebSearchQuery, signal: AbortSignal): Promise<WebSearchResult> {
        const params = new URLSearchParams({
          q: query.query,
          limit: String(query.limit),
        });

        const response = await network.fetch(`https://api.keenable.example/v1/search?${params}`, {
          headers: {
            Authorization: `Bearer ${query.apiKey ?? ''}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`Keenable search failed: ${response.status} ${response.statusText}`);
        }

        const data = JSON.parse(response.body);

        return {
          sources: (data.items ?? []).map((item: any) => ({
            title: item.title,
            url: item.url,
          })),
          results: (data.items ?? []).map((item: any) => ({
            title: item.title,
            url: item.url,
            snippet: item.snippet ?? item.description ?? '',
          })),
        };
      },
    });
  }
}
```

---

### Step 3 — Response Shape & Invariants

Your handler must return a `Promise<WebSearchResult>` conforming to:

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
  /** Sources shown as interactive pills and citations in Chat UI */
  sources: GroundingSource[];
  /** Detailed snippets passed to the agent model context */
  results: SearchResultEntry[];
}
```

#### Security & Quality Guarantees

- **URL Sanitization:** Asyar validates all returned URLs with `clean_url`. Only valid `http:` and `https:` URLs are accepted; non-standard or dangerous schemes (such as `javascript:`) are automatically stripped.
- **Result Clamping:** Results are automatically bounded to the requested `query.limit` (default 5, maximum 10).
- **Graceful Fallback:** If your worker throws an unhandled error, times out after 10 seconds, or the extension worker crashes, Asyar automatically falls back to its built-in DuckDuckGo engine so the user's AI conversation is never interrupted.

---

### Step 4 — Test Locally

1. Link or pack your extension:
   ```bash
   asyar pack
   ```
2. In Asyar, open **Settings → Extensions** and install or drag-and-drop your `.asyar` bundle.
3. Open **Settings → AI → Web Search**, select your engine from the **Extensions** group, and enter your API key if required.
4. Press `Tab` in the launcher or open **Ask AI** and ask a question requiring live web information (e.g. _"What are the latest releases of Rust this week?"_).
5. Watch the agent chat stream the live search status and display the interactive source pills and citations returned by your engine.
