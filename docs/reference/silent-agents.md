---
order: 60
---
# Silent AI Commands

A **silent AI command** is an agent that runs headlessly: the user
selects text somewhere in the OS (editor, browser, email), presses a
hotkey bound to the agent, and the launcher reads the selection, sends
it to the LLM, and replaces the selection in place with the model's
reply. The launcher window never opens. No confirm dialog, no preview,
no chat view. The reference UX is the Reddit "Silent AI command" flow
— one keystroke, in-place replacement, dozens of times a day.

Use this for one-shot text transformations: grammar fixes,
translations, tone adjustments, summaries, formatting touch-ups. For
multi-turn back-and-forth, keep the normal chat-view flow.

## How it works

Agents now carry three extra fields:

| Field | Type | Default | Meaning when `silent === false` |
| --- | --- | --- | --- |
| `silent` | `boolean` | `false` | Default chat-view flow. |
| `inputSource` | `'selection' \| 'clipboard' \| 'argument' \| 'none'` | `'argument'` | Stored but unused. |
| `outputAction` | `'replaceSelection' \| 'paste' \| 'copy' \| 'hud'` | `'replaceSelection'` | Stored but unused. |

When `silent === true`, dispatching the agent (via the launcher row
Enter or a bound item shortcut) routes to the **silent dispatcher**
instead of opening the chat view:

1. **Input capture** — read the user text from the chosen `inputSource`:
   - `selection` — macOS Accessibility selection of the previously
     frontmost app. Empty selection HUDs "No selection" and aborts.
   - `clipboard` — current clipboard contents. Empty clipboard HUDs
     "Clipboard is empty" and aborts.
   - `argument` — text typed in the launcher bar (or passed through
     command arguments). Empty string is acceptable.
   - `none` — empty string. The agent's system prompt is fully
     self-contained.
2. **LLM call** — a single assistant turn. Tools selected on the
   agent are still allowed: the loop iterates until the model emits a
   final non-tool-call response, same as the chat-view flow.
3. **Output action** — apply one of:
   - `replaceSelection` — save clipboard → write result → hide
     launcher → simulate Cmd+V → restore clipboard after ~200 ms.
   - `paste` — identical flow to `replaceSelection`. Distinct intent
     for apps without selection semantics.
   - `copy` — write result to clipboard only. No paste, no clipboard
     restore.
   - `hud` — show the last non-empty line of the result in a HUD
     toast.

The original clipboard contents are restored after a short delay so
the paste lands before the restore overwrites the result. Image and
file clipboard contents can't be saved as text — those won't be
restored after a `replaceSelection`/`paste` action.

## Run-tracker suppression — the hard rule

Silent agent invocations **must not** pollute the run tracker. They
bypass `runService.startLocal`, never create a thread row, never
insert messages, never touch `agentsManager.currentAgentId` or
`viewManager.navigateToView`. A hotkey-driven grammar fix run a
hundred times a day would otherwise flood the Scripts/Agents HUD
chips, the launcher kept-Done row, and the Runs view with kept rows.
This mirrors the inline-mode script scheduler: the timer-driven runs
bypass the normal `shellService.spawn` promotion so a 30 s clock
script doesn't pin a kept-Done row every tick.

Failures (provider error, missing API key, empty model response) are
the only thing surfaced — through `diagnosticsService.report({ kind:
'silent_agent_failed', severity: 'warning' })` plus a system
notification carrying the agent name and the error message. Success
is fully silent.

## Hotkeys

Silent agents use the same item-shortcut UI as any other launcher
row. Open the launcher, type the agent name, hit `Cmd+K` while the
row is selected, pick **Set Shortcut**, press your chosen key combo.
There are no manifest-declared per-command global hotkeys — this is
the user's choice, not the agent author's.

## Example — Grammar Fix

The canonical silent-AI command:

| Field | Value |
| --- | --- |
| Name | `Grammar Fix` |
| Description | `Silent agent: replace selected text with the grammar-corrected version.` |
| System prompt | (see below) |
| Provider | Your preferred LLM provider |
| Model | A fast model — `gpt-4o-mini`, `claude-3-5-haiku-20241022`, etc. |
| Silent | `true` |
| Input from | `Selected text in the active app` |
| Then | `Replace the selection with the result` |
| Tools | (none) |

System prompt:

> You are a grammar and style assistant. The user gives you a piece
> of text and you reply ONLY with the corrected version. Fix grammar,
> spelling, and awkward phrasing. Preserve the user’s original tone,
> voice, language, and formatting. Do not add preamble, commentary,
> or quotation marks — just the corrected text and nothing else.

To create it programmatically:

```ts
import { buildGrammarFixAgentInput } from 'asyar-launcher/.../defaultAgent';
import { agentService } from 'asyar-launcher/.../agentService.svelte';

await agentService.create(
  buildGrammarFixAgentInput('openai', 'gpt-4o-mini'),
);
```

After it appears in the launcher, bind a hotkey to its row through
the item-shortcut UI, select some text in any app, press the hotkey:
the text is replaced with the corrected version. The launcher window
never opens.

## Architecture notes

- Rust owns persistence: `silent` is an `INTEGER NOT NULL DEFAULT 0`
  column on `agents`; `input_source` / `output_action` are short
  lowercase strings stored as `TEXT`. Adding new variants is purely
  additive — the parser falls back to defaults for unknown values.
- The `init_table` migration uses the same idempotent `ALTER TABLE
  IF NOT EXISTS` guard pattern as `runs_history.subject_id` and
  `tail_output` — upgraded installs gain the columns in place
  without dropping data.
- The TS contract mirrors the Rust enums (camelCase string unions)
  in [`built-in-features/agents/types.ts`](../../asyar-launcher/src/built-in-features/agents/agents/types.ts).
- The silent dispatcher lives in
  [`silentDispatch.ts`](../../asyar-launcher/src/built-in-features/agents/silentDispatch.ts);
  the routing decision in
  [`dispatch.ts`](../../asyar-launcher/src/built-in-features/agents/dispatch.ts)
  is a single `if (agent.silent)` branch.

## Cross-links

- [Run Tracking](../explanation/run-tracking.md) — the run-promotion
  policy this feature deliberately bypasses.
- [Dynamic Commands](./dynamic-commands.md) — agents register as
  dynamic commands so hotkey binding goes through the standard
  item-shortcut path.
