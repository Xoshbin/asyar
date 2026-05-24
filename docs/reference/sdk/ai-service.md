### 8.15 `AIService` — Stream responses from the AI provider

**Runs in:** both worker and view.

**Permission required:** `ai:use`.

Exposes the user's configured AI provider to Tier 2 extensions as a real-time token stream. Extensions send a messages array and receive tokens as they arrive — the same streaming model used by the built-in AI chat, just surfaced through the SDK IPC bridge.

The service is only available when the user has configured an AI provider in Asyar settings **and** has not disabled the master "Allow extensions to use AI" toggle (Settings → AI → Allow extensions to use AI, on by default).

```typescript
type AIRole = 'system' | 'user' | 'assistant';

interface AIMessage {
  role: AIRole;
  content: string;
}

interface AIStreamParams {
  messages: AIMessage[];
  temperature?: number;  // 0–2, provider default if omitted
  maxTokens?: number;    // capped to the user's configured max
}

type AIErrorCode =
  | 'ai_not_configured'   // user has no provider set up
  | 'ai_disabled_by_user' // master toggle is off
  | 'provider_error'      // upstream API returned an error
  | 'invalid_request'     // bad messages array or params
  | 'internal_error'      // unexpected host-side failure
  | 'aborted';            // extension called handle.abort()

interface AIError {
  code: AIErrorCode;
  message: string;
}

interface AIStreamHandlers {
  onToken(token: string): void;
  onDone(): void;
  onError(error: AIError): void;
}

interface AIStreamHandle {
  abort(): void;
}

interface IAIService {
  stream(params: AIStreamParams, handlers: AIStreamHandlers): AIStreamHandle;
}
```

**Minimal usage:**

```typescript
import type { IAIService } from 'asyar-sdk';

const ai = context.getService<IAIService>('ai');

const handle = ai.stream(
  {
    messages: [
      { role: 'user', content: 'Summarise this in one sentence: ' + selectedText },
    ],
  },
  {
    onToken(token) { output += token; },
    onDone()       { console.log('Done'); },
    onError(err)   { console.warn('[AI] stream error:', err.code, err.message); },
  },
);

// Cancel mid-stream if needed:
handle.abort();
```

**Typical "act on selection with AI" pattern:**

```typescript
import type { IAIService, ISelectionService, IFeedbackService } from 'asyar-sdk';

const ai        = context.getService<IAIService>('ai');
const selection = context.getService<ISelectionService>('selection');
const feedback  = context.getService<IFeedbackService>('feedback');

async function summarise() {
  const text = await selection.getSelectedText();
  if (!text) { await feedback.showHUD('Nothing selected'); return; }

  let summary = '';
  let toastId: string | undefined;

  const toast = await feedback.showToast({ title: 'Summarising…', style: 'animated' });
  toastId = toast.id;

  ai.stream(
    { messages: [{ role: 'user', content: `Summarise in one sentence:\n\n${text}` }] },
    {
      onToken(token) { summary += token; },
      async onDone() {
        await feedback.updateToast(toastId!, { title: summary, style: 'success' });
      },
      async onError(err) {
        const msg =
          err.code === 'ai_not_configured' ? 'No AI provider configured' :
          err.code === 'ai_disabled_by_user' ? 'AI disabled for extensions' :
          `AI error: ${err.message}`;
        await feedback.updateToast(toastId!, { title: msg, style: 'failure' });
      },
    },
  );
}
```

**Multi-turn conversation (pass full history):**

```typescript
const messages: AIMessage[] = [
  { role: 'system', content: 'You are a concise assistant. Reply in plain text only.' },
  { role: 'user',   content: 'What is the capital of France?' },
  { role: 'assistant', content: 'Paris.' },
  { role: 'user',   content: 'And of Germany?' },
];

ai.stream({ messages }, handlers);
```

#### How it works under the hood

`AIService.stream()` is the only SDK call that does **not** follow the standard request/response IPC round-trip. It uses a different protocol built on top of unilateral postMessages:

1. **SDK side (before calling `broker.invoke`)** — the proxy generates a unique `streamId` and registers a `window.addEventListener('message', …)` handler for `asyar:stream` messages carrying that streamId. The listener is registered **before** the invoke call to eliminate the race condition where the first token arrives before the promise resolves.
2. **Host side (IpcRouter → AIService)** — the router dispatches to the host `AIService`, which validates the master toggle, AI configuration, and request shape. It then calls the engine's `streamChat` function **without awaiting it** (fire-and-forget), and immediately returns `{ streaming: true }` so the router can send the IPC ack.
3. **Token delivery** — as the engine yields tokens, the host `AIService` posts `asyar:stream` messages directly to the extension's iframe:
   ```typescript
   // chunk message (one per token):
   { type: 'asyar:stream', streamId, phase: 'chunk', data: { token: '...' } }

   // done message (one, at the end):
   { type: 'asyar:stream', streamId, phase: 'done' }

   // error message (one, replaces done on failure):
   { type: 'asyar:stream', streamId, phase: 'error', error: { code, message } }
   ```
4. **Abort** — `handle.abort()` posts `{ type: 'asyar:stream:abort', streamId }` to the host. The IpcRouter intercepts this message type before normal dispatch and calls `StreamDispatcher.abort(streamId)`, which cancels the underlying fetch via `AbortController`.

#### Concurrency

Multiple streams can be active simultaneously (e.g. two extensions running in parallel). Each stream is identified by its `streamId` and tracked independently. Starting the same `streamId` twice throws — but since the SDK generates `streamId` values internally, this is not something you need to manage.

#### Parameters and constraints

| Param | Default | Constraint |
|---|---|---|
| `temperature` | Provider default | 0–2 |
| `maxTokens` | User's configured max | Silently capped to the user's configured maximum — you cannot exceed it |

#### Error handling

| `AIErrorCode` | When it fires | What to do |
|---|---|---|
| `ai_not_configured` | No API key or provider is set up in Asyar settings | Prompt the user to configure AI in Asyar settings before using your extension |
| `ai_disabled_by_user` | The "Allow extensions to use AI" master toggle is off | Surface this clearly; respect the user's choice |
| `provider_error` | The upstream API returned an HTTP error (rate limit, invalid key, quota exceeded, etc.) | Show the message to the user; usually transient |
| `invalid_request` | Empty messages array, unsupported role, or other malformed input | Fix the request shape; this is a developer error |
| `internal_error` | Unexpected host-side failure | Log; consider retrying once |
| `aborted` | Your code called `handle.abort()` | Expected; no user-visible error needed unless you want one |

#### Privacy & security

`ai:use` grants your extension access to the user's personal AI provider credentials indirectly — you don't see the API key, but you do trigger calls that consume their quota. Reviewers will inspect extensions that declare `ai:use` to ensure the calls are made explicitly on user action, not silently in the background.

The user's "Allow extensions to use AI" toggle (Settings → AI) is a global off-switch that overrides all extensions regardless of their declared permissions. Always handle `ai_disabled_by_user` gracefully.

---
