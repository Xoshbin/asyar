import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { agentService } from './agentService.svelte';
import { agentsGet, agentsToolsList } from '../../lib/ipc/commands';
import { getProvider } from '../../services/ai/providerRegistry';
import { streamChat } from '../../services/ai/aiEngine';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { invokeTool } from './toolDispatch';
import { runService } from '../../services/run/runService.svelte';
import type { LocalRunHandle } from '../../services/run/runService.svelte';
import type { AgentDef, MessageDef } from './types';
import type { ChatMessage, LoopMessage, ProviderConfig } from '../../services/ai/IProviderPlugin';

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
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'agent_missing_api_key',
      severity: 'error',
      retryable: false,
      developerDetail: `API key for provider '${agent.providerId}' is not configured`,
    });
    throw new Error(`API key for provider '${agent.providerId}' is not configured`);
  }

  // Validate tool support BEFORE startLocal so errors skip Run creation
  const toolSelection: string[] = agent.toolSelection ?? [];
  if (toolSelection.length > 0 && !plugin.supportsTools) {
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'agent_provider_no_tool_support',
      severity: 'error',
      retryable: false,
      developerDetail: `provider '${agent.providerId}' does not support tool calling`,
    });
    throw new Error(`provider '${agent.providerId}' does not support tool calling`);
  }

  const label = `${agent.name}: ${input.userText.slice(0, 50)}`;
  const handle = await runService.startLocal({
    label,
    kind: 'agent',
    cancellable: true,
    extensionId: 'agents',
  });

  let cancelled = false;
  // True when cancel came from runService.cancelById (Run UI). In that case
  // the run state is already set to "cancelled" by the host, so we MUST NOT
  // call handle.cancel() again. Only cancel-via-abortSignal needs us to
  // mark the run state ourselves.
  let externallyCancelled = false;
  handle.onCancel(() => {
    cancelled = true;
    externallyCancelled = true;
  });

  if (input.abortSignal) {
    if (input.abortSignal.aborted) {
      cancelled = true;
    } else {
      input.abortSignal.addEventListener('abort', () => { cancelled = true; }, { once: true });
    }
  }

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
      await runTextOnly(input, agent, plugin, config as ProviderConfig, settings, handle, () => cancelled);
    } else {
      // Fetch all available tool descriptors and filter to selected ones
      const allDescriptors = await agentsToolsList();
      const selectedDescriptors = allDescriptors.filter((d) =>
        toolSelection.includes(d.fullyQualifiedId),
      );

      const tools = selectedDescriptors.map((d) => ({
        id: d.fullyQualifiedId,
        name: d.name,
        description: d.description,
        parameters: d.parameters,
      }));

      const params = {
        modelId: agent.modelId,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
      };

      // Build initial conversation history as LoopMessages
      const history = await agentService.listMessages(input.threadId);
      const currentMessages = buildLoopMessages(agent, history);

      await runToolLoop(input, agent, plugin, config as ProviderConfig, params, tools, currentMessages, handle, () => cancelled);
    }

    if (cancelled) {
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
    if (cancelled) {
      if (!externallyCancelled) {
        await handle.cancel().catch(() => {});
      }
    } else {
      await handle.fail(err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}

// ── Text-only path ────────────────────────────────────────────────────────────

async function runTextOnly(
  input: RunAgentInput,
  agent: AgentDef,
  plugin: ReturnType<typeof getProvider>,
  config: ProviderConfig,
  settings: ReturnType<typeof settingsService.getSettings>,
  handle: LocalRunHandle,
  isCancelled: () => boolean,
): Promise<void> {
  const history = await agentService.listMessages(input.threadId);
  const chatMessages = buildChatMessages(agent, history);

  const signal = input.abortSignal ?? new AbortController().signal;
  const streamId = `agent-${input.agentId}-${Date.now()}`;

  let accumulated = '';

  await new Promise<void>((resolve, reject) => {
    void streamChat(
      plugin!,
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
              kind: 'agent_stream_error',
              severity: 'error',
              retryable: false,
              developerDetail: errMsg,
            }),
          ).catch(() => {});
          reject(error);
        },
      },
      signal,
      streamId,
    );
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
  plugin: ReturnType<typeof getProvider>,
  config: ProviderConfig,
  params: { modelId: string; temperature: number; maxTokens: number },
  tools: Array<{ id: string; name: string; description: string; parameters: Record<string, unknown> }>,
  currentMessages: LoopMessage[],
  handle: LocalRunHandle,
  isCancelled: () => boolean,
): Promise<void> {
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Check cancel before starting a new LLM turn
    if (isCancelled()) return;

    // Build the request via the plugin's tool-capable builder
    const spec = plugin!.buildToolRequest!(currentMessages, config, params, tools);

    // Perform the HTTP fetch when a real spec is available (production path).
    // In unit tests, buildToolRequest returns undefined (vi.fn() default) and
    // parseToolStream is mocked to ignore its reader argument — so we skip the
    // fetch and pass undefined as the reader.
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (spec) {
      const response = await tauriFetch(spec.url, {
        method: 'POST',
        headers: spec.headers as Record<string, string>,
        body: JSON.stringify(spec.body),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(`API error: ${errText}`);
      }

      if (!response.body) {
        throw new Error('No response body received.');
      }

      reader = response.body.getReader();
    }

    // Parse the tool stream
    let accumText = '';
    const toolUses: Array<{ id: string; name: string; input: unknown }> = [];

    try {
      for await (const ev of plugin!.parseToolStream!(reader as ReadableStreamDefaultReader<Uint8Array>)) {
        if (ev.type === 'text') {
          accumText += ev.text;
          input.onAssistantTextDelta?.(ev.text, accumText);
          void handle.write(ev.text).catch(() => {});
        } else if (ev.type === 'tool_use') {
          toolUses.push({ id: ev.id, name: ev.name, input: ev.input });
          // Surface tool invocations in the Runs view too.
          void handle
            .write(`\n[tool] ${ev.name} ${JSON.stringify(ev.input)}\n`)
            .catch(() => {});
        } else if (ev.type === 'message_stop') {
          break;
        }
      }
    } finally {
      reader?.releaseLock();
    }

    // Persist the assistant message (with optional toolUse) BEFORE invoking tools
    const assistantContent: { text: string; toolUse?: Array<{ id: string; name: string; input: unknown }> } = {
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
        output = await invokeTool(tu.name, tu.input);
      } catch (err) {
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'agent_tool_invocation_error',
          severity: 'error',
          retryable: false,
          developerDetail: `tool '${tu.name}' failed: ${(err as Error)?.message ?? String(err)}`,
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
  await diagnosticsService.report({
    source: 'frontend',
    kind: 'agent_loop_max_turns',
    severity: 'error',
    retryable: false,
    developerDetail: `agent loop exceeded max turns (${MAX_TURNS})`,
  });
  throw new Error(`agent loop exceeded max turns (${MAX_TURNS})`);
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
      const content = msg.content as { text?: string; toolUse?: Array<{ id: string; name: string; input: unknown }> };
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

  return out;
}
