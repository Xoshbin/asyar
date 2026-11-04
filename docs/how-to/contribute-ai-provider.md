---
order: 6
---

## Contribute an AI Provider to Asyar

Asyar features an extensible **AI Model & Inference Provider SPI (Service Provider Interface)** that allows Tier 2 extensions to contribute custom LLM inference engines and model catalogs to Asyar's built-in Agent runtime.

When an extension contributes an AI provider:

- It appears automatically in **Settings → AI** in the **+ Add Provider** dropdown alongside built-in providers (Anthropic, OpenAI, Google, Ollama, etc.).
- If your provider requires an API key or custom endpoint URL, Asyar renders the credential configuration fields, prompts the user, and securely stores the keys encrypted on device in its AES-256-GCM vault.
- During AI conversations and agent runs, Asyar's runner dispatches completion requests to your extension worker over IPC.
- Token chunks, tool calls, and status messages stream back in real time with bidirectional cancellation support.
- If your extension implements dynamic model discovery (`listModels`), users can click **Test & Fetch Models** to pull available models directly from your service into Asyar's searchable model selector.

---

### Step 1 — Declare `aiProviders` in `manifest.json`

Add `"network"` and `"ai:provider"` to your `permissions` array, declare a background worker via `background.main`, and define your provider under `aiProviders`:

```json
{
  "id": "org.example.groq",
  "name": "Groq AI Provider",
  "version": "1.0.0",
  "permissions": ["network", "ai:provider"],
  "background": {
    "main": "dist/worker.js"
  },
  "aiProviders": [
    {
      "id": "groq",
      "name": "Groq",
      "description": "Ultra-fast LPU inference for open models.",
      "homepage": "https://groq.com",
      "requiresApiKey": true,
      "apiKeyPlaceholder": "gsk_...",
      "apiKeyHelpUrl": "https://console.groq.com/keys",
      "models": [
        {
          "id": "llama-3.3-70b-versatile",
          "name": "Llama 3.3 70B Versatile",
          "contextWindow": 128000
        },
        {
          "id": "mixtral-8x7b-32768",
          "name": "Mixtral 8x7B",
          "contextWindow": 32768
        }
      ]
    }
  ]
}
```

#### Manifest Fields Reference

| Field                | Type                | Required | Description                                                                           |
| -------------------- | ------------------- | -------- | ------------------------------------------------------------------------------------- |
| `id`                 | `string`            | ✅       | Short provider identifier (`^[a-z0-9_-]{1,64}$`). Fully qualified as `ext:<id>:<id>`. |
| `name`               | `string`            | ✅       | Display label shown in the Settings dropdown and model selector.                      |
| `description`        | `string`            | ❌       | Subtitle / description displayed in Settings.                                         |
| `homepage`           | `string`            | ❌       | Project or documentation homepage (`http://` or `https://`).                          |
| `requiresApiKey`     | `boolean`           | ❌       | Prompt for a required API key in Settings (defaults to `true`).                       |
| `apiKeyOptional`     | `boolean`           | ❌       | Prompt for an optional API key in Settings (e.g. for free tiers or local servers).    |
| `apiKeyPlaceholder`  | `string`            | ❌       | Custom placeholder text for the API key input.                                        |
| `apiKeyHelpUrl`      | `string`            | ❌       | Link for the user to obtain an API key (`http://` or `https://`).                     |
| `requiresBaseUrl`    | `boolean`           | ❌       | Prompt for a custom endpoint URL (useful for self-hosted instances).                  |
| `baseUrlPlaceholder` | `string`            | ❌       | Custom placeholder for the endpoint URL input.                                        |
| `models`             | `ManifestAiModel[]` | ❌       | Initial static list of supported models (`id`, `name`, `contextWindow`).              |

---

### Step 2 — Register the provider handler in your worker

In your background entrypoint (`src/worker.ts`), register your inference handler using `context.ai.registerAiProvider` inside your extension's `initialize` method:

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

      // 1. Streaming chat completion handler
      async completeStream(
        request: AiCompletionRequest,
        onChunk: AiStreamCallback,
        signal: AbortSignal,
      ): Promise<void> {
        const endpoint = request.baseUrl ?? 'https://api.groq.com/openai/v1/chat/completions';

        const response = await fetch(endpoint, {
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
        });

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
                // Emit streaming token to Asyar
                onChunk({ type: 'token', token });
              }
            }
          }
        }
      },

      // 2. Optional dynamic model discovery handler
      async listModels(config: AiProviderConfig, signal: AbortSignal): Promise<AiModelInfo[]> {
        const endpoint = config.baseUrl ?? 'https://api.groq.com/openai/v1/models';

        const response = await fetch(endpoint, {
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

### Step 3 — Stream Chunk Protocol

When streaming responses, invoke `onChunk` with one of the following typed chunk objects:

- `{ type: 'token', token: string }`: Incremental text generated by the model.
- `{ type: 'tool_call', id: string, name: string, input: unknown }`: Structured tool call requests if supporting agentic tool use.
- `{ type: 'status', status: string }`: Status update (e.g. "Thinking...", "Connecting...") displayed in the conversation footer.

Asyar automatically buffers, sequences, and safely flushes chunks into the active conversation thread while persisting message state in SQLite.

---

### Step 4 — Cancellation Safety

Always forward the supplied `signal: AbortSignal` to your outbound network calls (e.g., `fetch(..., { signal })`).

When the user clicks the Stop button, summons another window, or closes the launcher:

- Asyar immediately aborts the `AbortSignal`.
- In-flight HTTP requests and stream loops cancel cleanly.
- No dangling promises or network leaks remain in the background worker.

---

### Step 5 — Testing in Asyar

1. Build your extension: `pnpm build`.
2. In Asyar, open **Settings → Extensions** (`⌘,`) and click **Install from disk** to load your unpacked extension directory.
3. Switch to **Settings → AI**, click **+ Add provider**, and select your extension provider.
4. Enter an API key and click **Test & Fetch Models** to verify dynamic connectivity.
5. Create or edit an Agent in **Settings → AI → Agents**, assign your new provider and model, and start chatting!
