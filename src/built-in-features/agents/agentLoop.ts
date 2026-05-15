import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { agentService } from './agentService.svelte';
import { agentsGet, agentsToolsList } from '../../lib/ipc/commands';
import { getProvider } from '../../services/ai/providerRegistry';
import { streamChat } from '../../services/ai/aiEngine';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { invokeTool } from './toolDispatch';
import { runService } from '../../services/run/runService.svelte';
import { logService } from '../../services/log/logService';
import { extractErrorMessage } from '../../lib/errors';
import type { LocalRunHandle } from '../../services/run/runService.svelte';
import type { AgentDef, MessageDef } from './types';
import type { IProviderPlugin, ChatMessage, LoopMessage, ProviderConfig, ToolCall } from '../../services/ai/IProviderPlugin';

export interface RunAgentInput {
  agentId: string;
  threadId: string;
  userText: string;
  abortSignal?: AbortSignal;
  /**
   * Fired immediately after the user message is persisted, before the LLM
   * call starts. Lets the chat view refresh so the user message appears
   * without waiting for the assistant response to complete.
   */
  onUserMessagePersisted?: () => void;
  /**
   * Fired for each text delta from the streaming response. The chat view
   * uses this to render an in-flight assistant bubble token-by-token.
   * `accumulated` is the full text seen so far for the current turn.
   */
  onAssistantTextDelta?: (delta: string, accumulated: string) => void;
  /**
   * Fired after each turn's assistant message has been persisted. The chat
   * view refreshes the message list and clears any streaming buffer.
   */
  onAssistantTurnPersisted?: () => void;
}

const MAX_TURNS = 20;

export async function runAgent(input: RunAgentInput): Promise<void> {
  if (input.abortSignal?.aborted) {
    return;
  }

  const agent = await loadAgent(input.agentId);

  const plugin = getProvider(agent.providerId as Parameters<typeof getProvider>[0]);
  if (!plugin) {
    throw new Error(`provider '${agent.providerId}' not registered`);
  }

  const settings = settingsService.getSettings();
  const config = settings.ai.providers[agent.providerId as keyof typeof settings.ai.providers];
  if (!config?.apiKey) {
    const msg = `API key for provider '${agent.providerId}' is not configured`;
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'manual',
      severity: 'error',
      retryable: false,
      context: { message: msg },
    });
    throw new Error(msg);
  }

  const toolSelection: string[] = agent.toolSelection ?? [];

  const label = `${agent.name}: ${input.userText.slice(0, 50)}`;
  const handle = await runService.startLocal({
    label,
    kind: 'agent',
    cancellable: true,
    extensionId: 'agents',
    // Tag the run with the agent's dynamic-command object_id
    // (`cmd_agents_dyn_<agentId>`) so the launcher list joins by direct
    // equality. Per-agent (not per-thread): concurrent threads of the same
    // agent share one dot in the list — see Decision 6 in the dot-statuses
    // plan. Per-thread visibility, if ever needed, is a separate follow-up.
    subjectId: `cmd_agents_dyn_${input.agentId}`,
  });

  // Single AbortController owns cancellation for this run. Both cancel paths
  // — handle.onCancel (Cancel Run from launcher action panel) and
  // input.abortSignal (chat-view Cancel button / unmount) — abort this
  // controller, which is the signal handed to streamChat / tauriFetch. That
  // makes cancellation propagate INTO the in-flight HTTP read instead of only
  // being noticed between turns.
  const cancelController = new AbortController();
  // True when cancel came from runService.cancelById (Run UI). In that case
  // the run state is already set to "cancelled" by the host, so we MUST NOT
  // call handle.cancel() again. Only cancel-via-abortSignal needs us to
  // mark the run state ourselves.
  let externallyCancelled = false;
  handle.onCancel(() => {
    externallyCancelled = true;
    cancelController.abort();
  });

  if (input.abortSignal) {
    if (input.abortSignal.aborted) {
      cancelController.abort();
    } else {
      input.abortSignal.addEventListener(
        'abort',
        () => cancelController.abort(),
        { once: true },
      );
    }
  }

  const isCancelled = () => cancelController.signal.aborted;

  try {
    // Insert user message
    await agentService.insertMessage({
      threadId: input.threadId,
      role: 'user',
      content: { text: input.userText },
      runId: handle.id,
    });
    input.onUserMessagePersisted?.();

    if (toolSelection.length === 0) {
      // Text-only path
      await runTextOnly(input, agent, plugin, config as ProviderConfig, settings, handle, cancelController.signal, isCancelled);
    } else {
      // Fetch all available tool descriptors and filter to selected ones
      const allDescriptors = await agentsToolsList();
      const selectedDescriptors = allDescriptors.filter((d) =>
        toolSelection.includes(d.fullyQualifiedId),
      );

      // Anthropic's tool name regex is `^[a-zA-Z0-9_-]{1,64}$`, so the colons
      // and dots in our FQIDs (`builtin:calculator`, `ext.foo:bar`) get rejected
      // at the API layer. Encode for the wire and keep a map so we can resolve
      // tool_use blocks back to the original FQID before invoking.
      const wireToFqid = new Map<string, string>();
      const tools = selectedDescriptors.map((d) => {
        const wireId = encodeToolIdForWire(d.fullyQualifiedId);
        wireToFqid.set(wireId, d.fullyQualifiedId);
        return {
          id: wireId,
          name: d.name,
          description: d.description,
          parameters: d.parameters,
        };
      });

      const params = {
        modelId: agent.modelId,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
      };

      // Build initial conversation history as LoopMessages
      const history = await agentService.listMessages(input.threadId);
      const currentMessages = buildLoopMessages(agent, history);

      await runToolLoop(input, agent, plugin, config as ProviderConfig, params, tools, currentMessages, wireToFqid, handle, cancelController.signal, isCancelled);
    }

    if (isCancelled()) {
      // Loop exited because of cancellation. If the cancel originated from
      // an external runService.cancelById call (Run UI), the run is already
      // in cancelled state — do nothing. If the cancel originated from our
      // own AbortSignal (chat Cancel button or chat-view unmount), the run
      // is still in Running state and we have to mark it cancelled here,
      // otherwise the runs list shows it as "Running" forever.
      if (!externallyCancelled) {
        await handle.cancel().catch(() => {});
      }
    } else {
      await handle.done();
    }
  } catch (err) {
    if (isCancelled()) {
      // Cancellation aborted the in-flight fetch / stream, which throws an
      // AbortError. That's expected — don't surface it as a failure. The run
      // state is either already 'cancelled' (externallyCancelled) or we
      // mark it ourselves here.
      if (!externallyCancelled) {
        await handle.cancel().catch(() => {});
      }
      return;
    }
    await handle.fail(extractErrorMessage(err));
    throw err;
  }
}

// ── Text-only path ────────────────────────────────────────────────────────────

async function runTextOnly(
  input: RunAgentInput,
  agent: AgentDef,
  plugin: IProviderPlugin,
  config: ProviderConfig,
  settings: ReturnType<typeof settingsService.getSettings>,
  handle: LocalRunHandle,
  signal: AbortSignal,
  isCancelled: () => boolean,
): Promise<void> {
  const history = await agentService.listMessages(input.threadId);
  const chatMessages = buildChatMessages(agent, history);

  const streamId = `agent-${input.agentId}-${Date.now()}`;

  let accumulated = '';

  await new Promise<void>((resolve, reject) => {
    // streamChat returns a promise. If it rejects synchronously (e.g. the
    // plugin's buildRequest throws on a malformed config) the rejection is
    // unhandled and surfaces as a generic "Unexpected error" in the
    // diagnostics bar. Plumb its rejection into our reject() so the caller
    // gets a real error message.
    streamChat(
      plugin,
      config,
      chatMessages,
      {
        modelId: agent.modelId,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
      },
      {
        onToken: (token: string) => {
          accumulated += token;
          input.onAssistantTextDelta?.(token, accumulated);
          // Mirror tokens into the Run handle so the Runs view shows live
          // streaming output. Best-effort — write failures don't abort the
          // assistant turn.
          void handle.write(token).catch(() => {});
        },
        onDone: () => {
          resolve();
        },
        onError: (errMsg: string) => {
          const error = new Error(errMsg);
          if (accumulated.length > 0) {
            void agentService
              .insertMessage({
                threadId: input.threadId,
                role: 'assistant',
                content: { text: accumulated },
                runId: handle.id,
              })
              .catch(() => {});
          }
          void Promise.resolve(
            diagnosticsService.report({
              source: 'frontend',
              kind: 'manual',
              severity: 'error',
              retryable: false,
              context: { message: `Agent error: ${errMsg}` },
            }),
          ).catch(() => {});
          reject(error);
        },
      },
      signal,
      streamId,
    ).catch(reject);
  });

  if (isCancelled()) {
    return;
  }

  if (accumulated.length > 0) {
    await agentService.insertMessage({
      threadId: input.threadId,
      role: 'assistant',
      content: { text: accumulated },
      runId: handle.id,
    });
    input.onAssistantTurnPersisted?.();
  }
}

// ── Tool-calling multi-turn loop ──────────────────────────────────────────────

async function runToolLoop(
  input: RunAgentInput,
  agent: AgentDef,
  plugin: IProviderPlugin,
  config: ProviderConfig,
  params: { modelId: string; temperature: number; maxTokens: number },
  tools: Array<{ id: string; name: string; description: string; parameters: Record<string, unknown> }>,
  currentMessages: LoopMessage[],
  wireToFqid: Map<string, string>,
  handle: LocalRunHandle,
  signal: AbortSignal,
  isCancelled: () => boolean,
): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Check cancel before starting a new LLM turn
    if (isCancelled()) return;

    // Build the request via the plugin's tool-capable builder
    const spec = plugin.buildToolRequest(currentMessages, config, params, tools);

    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    // Guard supports unit-test mocks where `buildToolRequest` is `vi.fn()`
    // and returns `undefined` so the test drives the loop without faking
    // a full RequestSpec + HTTP fetch.
    if (spec) {
      // Log the outgoing request body so we can compare against the API
      // contract when the provider rejects with `invalid_request_error`.
      // x-api-key is stripped before logging.
      try {
        logService.debug(
          `[agents] tool-request body: ${JSON.stringify(spec.body)}`,
        );
      } catch { /* unstringifiable bodies — skip */ }

      const response = await tauriFetch(spec.url, {
        method: 'POST',
        headers: spec.headers as Record<string, string>,
        body: JSON.stringify(spec.body),
        signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        // Always log the full body — diagnostic UI truncates and the user
        // can't see what specifically the provider objected to.
        logService.error(
          `[agents] provider ${response.status} response: ${errText}`,
        );
        // Try to surface just the human message from Anthropic's error envelope:
        //   { type: "error", error: { type: "...", message: "..." } }
        let humanMsg = errText;
        try {
          const parsed = JSON.parse(errText) as {
            error?: { message?: string };
          };
          if (parsed?.error?.message) humanMsg = parsed.error.message;
        } catch { /* keep raw text */ }
        throw new Error(`API ${response.status}: ${humanMsg}`);
      }

      if (!response.body) {
        throw new Error('No response body received.');
      }

      reader = response.body.getReader();
    }

    // Parse the tool stream
    let accumText = '';
    const toolUses: ToolCall[] = [];

    try {
      for await (const ev of plugin.parseToolStream(reader as ReadableStreamDefaultReader<Uint8Array>)) {
        if (isCancelled()) break;
        if (ev.type === 'text') {
          accumText += ev.text;
          input.onAssistantTextDelta?.(ev.text, accumText);
          void handle.write(ev.text).catch(() => {});
        } else if (ev.type === 'tool_use') {
          // The provider may have rejected the colon in our FQID; we sent
          // wire-encoded names, so decode back via the map. Fall back to the
          // raw name if the provider preserved it (no real tools today, but
          // future provider plugins may not encode).
          const resolvedFqid = wireToFqid.get(ev.name) ?? ev.name;
          toolUses.push({ id: ev.id, name: resolvedFqid, input: ev.input });
          // Surface tool invocations in the Runs view too.
          void handle
            .write(`\n[tool] ${resolvedFqid} ${JSON.stringify(ev.input)}\n`)
            .catch(() => {});
        } else if (ev.type === 'message_stop') {
          break;
        }
      }
    } finally {
      reader?.releaseLock();
    }

    // Persist the assistant message (with optional toolUse) BEFORE invoking tools
    const assistantContent: { text: string; toolUse?: ToolCall[] } = {
      text: accumText,
    };
    if (toolUses.length > 0) {
      assistantContent.toolUse = toolUses;
    }

    await agentService.insertMessage({
      threadId: input.threadId,
      role: 'assistant',
      content: assistantContent,
      runId: handle.id,
    });
    input.onAssistantTurnPersisted?.();

    const assistantLoopMsg: LoopMessage = {
      role: 'assistant',
      content: accumText,
    };
    if (toolUses.length > 0) {
      assistantLoopMsg.toolUse = toolUses;
    }
    currentMessages.push(assistantLoopMsg);

    // If no tool calls, we're done
    if (toolUses.length === 0) {
      return;
    }

    // Sequentially invoke each tool (no mid-tool abort — tools always run to completion)
    for (const tu of toolUses) {
      let output: unknown;
      try {
        output = await invokeTool(tu.name, tu.input, agent.id);
      } catch (err) {
        const detail = extractErrorMessage(err);
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'manual',
          severity: 'error',
          retryable: false,
          developerDetail: detail,
          context: { message: `Tool '${tu.name}' failed: ${detail}` },
        });
        throw err;
      }

      // Persist tool result message
      await agentService.insertMessage({
        threadId: input.threadId,
        role: 'tool',
        content: { toolResult: { toolUseId: tu.id, output } },
        runId: handle.id,
      });
      void handle
        .write(`[tool result] ${JSON.stringify(output)}\n`)
        .catch(() => {});

      // Add to loop messages for next turn
      currentMessages.push({
        role: 'tool',
        content: JSON.stringify(output),
        toolUseId: tu.id,
      });
    }

    // Check cancel AFTER all tool results are persisted, BEFORE next LLM turn
    if (isCancelled()) return;
  }

  // Loop guard exceeded
  const guardMsg = `Agent loop exceeded max turns (${MAX_TURNS})`;
  await diagnosticsService.report({
    source: 'frontend',
    kind: 'manual',
    severity: 'error',
    retryable: false,
    context: { message: guardMsg },
  });
  throw new Error(guardMsg);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadAgent(agentId: string): Promise<AgentDef> {
  const cached = agentService.getById(agentId);
  if (cached) return cached;
  const fetched = await agentsGet(agentId);
  if (!fetched) throw new Error(`agent '${agentId}' not found`);
  return fetched;
}

function buildChatMessages(agent: AgentDef, history: MessageDef[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (agent.systemPrompt) {
    out.push({
      id: `system-${agent.id}`,
      role: 'system',
      content: agent.systemPrompt,
      timestamp: 0,
    });
  }
  for (const msg of history) {
    if (msg.role === 'user') {
      const text = (msg.content as { text?: string })?.text ?? '';
      out.push({ id: msg.id, role: 'user', content: text, timestamp: msg.createdAt });
    } else if (msg.role === 'assistant') {
      const text = (msg.content as { text?: string })?.text ?? '';
      out.push({ id: msg.id, role: 'assistant', content: text, timestamp: msg.createdAt });
    }
  }
  return out;
}

function buildLoopMessages(agent: AgentDef, history: MessageDef[]): LoopMessage[] {
  const out: LoopMessage[] = [];

  if (agent.systemPrompt) {
    out.push({ role: 'system', content: agent.systemPrompt });
  }

  for (const msg of history) {
    if (msg.role === 'user') {
      const text = (msg.content as { text?: string })?.text ?? '';
      out.push({ role: 'user', content: text });
    } else if (msg.role === 'assistant') {
      const content = msg.content as { text?: string; toolUse?: ToolCall[] };
      const loopMsg: LoopMessage = { role: 'assistant', content: content.text ?? '' };
      if (content.toolUse && content.toolUse.length > 0) {
        loopMsg.toolUse = content.toolUse;
      }
      out.push(loopMsg);
    } else if (msg.role === 'tool') {
      const content = msg.content as { toolResult?: { toolUseId?: string; output?: unknown } };
      const toolResult = content.toolResult;
      out.push({
        role: 'tool',
        content: JSON.stringify(toolResult?.output),
        toolUseId: toolResult?.toolUseId,
      });
    }
  }

  return coalesceConsecutiveSameRole(out);
}

/**
 * Anthropic (and most providers) require strictly alternating user/assistant
 * messages. When earlier sends fail mid-flight, the database holds orphan
 * user messages with no matching assistant turn — replaying that history
 * verbatim makes the next request 400 with `invalid_request_error`. Merge
 * runs of consecutive same-role messages by joining their text with blank
 * lines so the LLM still sees every user input but the wire shape stays
 * legal.
 *
 * Tool messages are passed through unchanged: they map to Anthropic's
 * `tool_result` content blocks and don't follow the user/assistant
 * alternation rule. Assistant messages with toolUse blocks are NOT merged
 * because each turn's tool calls have unique ids.
 */
export function coalesceConsecutiveSameRole(messages: LoopMessage[]): LoopMessage[] {
  const out: LoopMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    const canMerge =
      last !== undefined &&
      last.role === m.role &&
      (m.role === 'user' || m.role === 'assistant') &&
      !last.toolUse &&
      !m.toolUse;
    if (canMerge) {
      const joined = last.content && m.content
        ? `${last.content}\n\n${m.content}`
        : last.content || m.content;
      out[out.length - 1] = { ...last, content: joined };
    } else {
      out.push(m);
    }
  }
  return out;
}

/**
 * Anthropic (and likely other) tool name regex: `^[a-zA-Z0-9_-]{1,64}$`.
 * Our FQIDs use `:` to separate source from id and `.` inside extension ids,
 * both of which the API rejects. Encode for the wire and keep a per-request
 * map (in `runToolLoop`) for exact-match decode of incoming `tool_use.name`.
 *
 * Encoding: `:` → `__`, `.` → `--`. Both are wire-safe characters. Decoding
 * is map-based (not transform-based) so any naturally-occurring `__` or `--`
 * in a tool id can't cause collisions.
 */
export function encodeToolIdForWire(fullyQualifiedId: string): string {
  return fullyQualifiedId.replace(/:/g, '__').replace(/\./g, '--');
}
