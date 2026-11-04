---
order: 7
---

## Contribute a Web Content Reader / Markdown Scraper to Asyar

Asyar features an extensible **Web Content Reader SPI (Service Provider Interface)** (`webReaders`) that allows Tier 2 extensions to contribute web content scraping and clean Markdown extraction providers to Asyar's built-in AI agent.

When an extension contributes a web reader:

- It appears automatically in **Settings → AI → Web Reader**.
- If your reader requires an API key (e.g. Jina Reader, Firecrawl, Spider) or a custom base URL (e.g. self-hosted instance), Asyar renders the credential configuration fields and stores the keys encrypted on device.
- During AI conversations, when an agent invokes `builtin:web-fetch`, Asyar dispatches URL extraction queries to your extension worker over IPC.
- The returned clean Markdown or extracted text is fed directly into the model context, bypassing raw HTML boilerplate, SPAs, and bot challenges.

---

### Step 1 — Declare `webReaders` in `manifest.json`

Add `"network"` and `"ai:web-reader"` to your `permissions` array, declare a background worker via `background.main`, and define your reader under `webReaders`:

```json
{
  "id": "org.example.jina",
  "name": "Jina Reader",
  "version": "1.0.0",
  "description": "Extracts clean Markdown from any URL using Jina Reader.",
  "permissions": ["network", "ai:web-reader"],
  "background": {
    "main": "dist/worker.js"
  },
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

#### Manifest Fields Reference

| Field                | Type      | Required | Description                                                          |
| -------------------- | --------- | -------- | -------------------------------------------------------------------- |
| `id`                 | `string`  | ✅       | Short reader identifier (must match `/^[a-z0-9_-]{1,64}$/`).         |
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

### Step 2 — Register the reader handler in your worker

In your background entrypoint (`src/worker.ts`), register your handler using `context.ai.registerWebReader` inside your extension's `initialize` method:

```typescript
import type { ExtensionContext } from 'asyar-sdk/worker';
import type { INetworkService, WebReaderQuery, WebReaderResult } from 'asyar-sdk/contracts';

export default class JinaReaderExtension {
  async initialize(context: ExtensionContext): Promise<void> {
    const network = context.getService<INetworkService>('network');

    context.ai.registerWebReader({
      id: 'jina-reader',
      async read(query: WebReaderQuery, signal: AbortSignal): Promise<WebReaderResult> {
        const targetUrl = query.url;
        const readerEndpoint = `https://r.jina.ai/${targetUrl}`;

        const headers: Record<string, string> = {
          Accept: 'text/markdown, text/plain',
        };
        if (query.apiKey) {
          headers['Authorization'] = `Bearer ${query.apiKey}`;
        }

        const response = await network.fetch(readerEndpoint, {
          headers,
        });

        if (!response.ok) {
          throw new Error(`Jina Reader failed: HTTP ${response.status} ${response.statusText}`);
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

---

### Step 3 — Response Shape & Invariants

Your handler must return a `Promise<WebReaderResult>` conforming to:

```typescript
export interface WebReaderResult {
  /** The final scraped URL */
  url: string;
  /** Page title if extracted */
  title?: string;
  /** Clean Markdown or extracted text for LLM context */
  content: string;
  /** HTTP response status code */
  status?: number;
  /** Optional metadata tags */
  metadata?: Record<string, unknown>;
}
```

#### Security & Quality Guarantees

- **Content Bounding:** To protect the LLM context window from blowout on multi-megabyte pages, Asyar keeps the first 100,000 characters of returned content and appends a truncation indicator when the content exceeds that length.
- **Fail-Safe Fallback:** If your worker throws an unhandled error, times out after 20 seconds, or the extension worker is unmounted, Asyar automatically logs a warning and falls back to native direct HTTP fetch so the user's AI conversation is never interrupted.
- **Bypass for Mutation Requests:** Non-GET requests (e.g. `POST`, `PUT`) or requests with an explicit request `body` bypass the reader and use native HTTP fetch directly.

---

### Step 4 — Test Locally

1. Link or pack your extension:
   ```bash
   asyar pack
   ```
2. In Asyar, open **Settings → Extensions** and install or drag-and-drop your `.asyar` bundle.
3. Open **Settings → AI → Web Reader**, select your reader from the **Extensions** group, and enter your API key if required.
4. Open **Ask AI** and ask a question that involves reading an article or documentation page (e.g. _"Read and summarize https://news.ycombinator.com"_).
5. Verify in logs or network inspection that the URL is cleanly resolved by your extension reader.
