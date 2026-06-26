/**
 * Silent AI command dispatch.
 *
 * A "silent" agent runs headlessly: it captures input from the chosen
 * source (selection / clipboard / argument / none), calls the LLM once
 * (with tools if the agent has any), and applies the chosen output
 * action to the final assistant message. The launcher window never
 * opens, no chat thread is created, and no Run is promoted into
 * `runService` — failures (and only failures) surface through
 * diagnostics + a system notification.
 *
 * Run-tracker suppression mirrors `inline_scheduler.rs`: the inline
 * scheduler bypasses `shellService.spawn` so its 30-second ticks
 * don't flood `runService.unacknowledgedScriptResults`. Same idea
 * here — a hotkey-driven grammar fix shouldn't pin a kept-Done row
 * to the launcher every keystroke.
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { readText, writeText } from 'tauri-plugin-clipboard-x-api';
import { agentsGet, agentsToolsList, simulatePaste } from '../../lib/ipc/commands';
import { getProvider } from '../../services/ai/providerRegistry';
import { streamChat } from '../../services/ai/aiEngine';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { feedbackService, type HudSpinnerHandle } from '../../services/feedback/feedbackService.svelte';
import { notificationService } from '../../services/notification/notificationService';
import { windowService } from '../../services/window/windowService';
import { selectionService } from '../../services/selection/selectionService';
import { logService } from '../../services/log/logService';
import { extractErrorMessage } from '../../lib/errors';
import { agentService } from './agentService.svelte';
import { invokeTool } from './toolDispatch';
import { encodeToolIdForWire } from './agentLoop';
import type {
  AgentDef,
  SilentInputSource,
  SilentOutputAction,
} from './types';
import type {
  IProviderPlugin,
  ChatMessage,
  LoopMessage,
  ProviderConfig,
  ToolCall,
} from '../../services/ai/IProviderPlugin';

/**
 * How long to wait between writing the clipboard / simulating paste and
 * restoring the previous clipboard contents. The paste must complete
 * before the restore, otherwise the user sees their original clipboard
 * content pasted instead of the model output. macOS paste latency is
 * tens of milliseconds in practice — 200ms is a safe margin.
 */
const CLIPBOARD_RESTORE_DELAY_MS = 200;

/** Cap on tool-using silent agents — mirrors agentLoop's MAX_TURNS. */
const MAX_TOOL_TURNS = 20;

export interface SilentDispatchInput {
  /** Agent id (already verified to be `silent: true` by the caller). */
  agentId: string;
  /** Optional explicit user text — overrides `agent.inputSource`. */
  userText?: string;
  /** Optional abort signal — lets the caller cancel mid-flight. */
  abortSignal?: AbortSignal;
  /**
   * Optional pre-built AgentDef. When provided, the dispatcher skips
   * agent lookup (no SQLite / in-memory store hit) and uses this def
   * directly. Used by built-in agents (e.g. emoji-fallback) that are
   * resolved from code rather than the user-visible agent registry.
   * `agentId` must still match `agentDef.id` for telemetry consistency.
   */
  agentDef?: AgentDef;
  /**
   * Optional callback fired with the agent's final assistant message text
   * once the run completes. Errors thrown by this callback are caught and
   * reported via diagnosticsService — they do not affect the run.
   */
  onFinalText?: (text: string) => void | Promise<void>;
}

/**
 * Public entry point. Errors are logged + surfaced through diagnostics
 * and a system notification but do not propagate to the caller — the
 * silent UX has no way to display a thrown error to the user.
 */
export async function dispatchSilentAgentCommand(
  input: SilentDispatchInput,
): Promise<void> {
  let resolvedAgent: AgentDef | null = null;
  let spinner: HudSpinnerHandle | null = null;
  try {
    if (input.agentDef && input.agentDef.id !== input.agentId) {
      logService.warn(
        `[silentDispatch] agentId mismatch: input.agentId="${input.agentId}" but agentDef.id="${input.agentDef.id}". Using agentDef.`,
      );
    }
    const agent: AgentDef = input.agentDef ?? await loadAgent(input.agentId);
    resolvedAgent = agent;
    if (!agent.silent) {
      throw new Error(
        `dispatchSilentAgentCommand called for non-silent agent '${agent.id}'`,
      );
    }

    // Spinner up immediately so the user knows their hotkey was captured —
    // input capture + LLM call together can take 1-3 seconds during which
    // the launcher window is intentionally hidden.
    spinner = feedbackService.showHUDSpinning(`✨ ${agent.name}…`);

    const userText = await captureInput(agent.inputSource, input.userText);
    if (userText === null) {
      // captureInput already surfaced a HUD warning ("No selection", etc),
      // which replaces our spinner. Don't dismiss — the warning would vanish.
      spinner = null;
      return;
    }

    const result = await runSilentAgentTurn(agent, userText, input.abortSignal);
    if (result === null) {
      // Cancelled mid-flight — dismiss the spinner; no error toast needed
      // (the user did the cancelling).
      await spinner.dismiss();
      spinner = null;
      return;
    }
    if (result.trim().length === 0) {
      // If caller wired onFinalText, give them the empty result so they can
      // cache it / handle it silently. The caller is taking responsibility
      // for surfacing (or suppressing) any user-visible feedback.
      if (input.onFinalText) {
        await spinner.dismiss();
        spinner = null;
        try {
          await input.onFinalText('');
        } catch (e) {
          await diagnosticsService.report({
            source: 'frontend',
            kind: 'silent_agent_failed',
            severity: 'warning',
            retryable: false,
            developerDetail: String(e),
            context: { message: 'onFinalText threw on empty result', agentId: input.agentId },
          });
        }
        return;
      }
      // No onFinalText wired — fall back to the existing warning UX.
      await spinner.replace('⚠️ Empty response', { spinning: false, durationMs: 3000 });
      spinner = null;
      await reportFailure(agent, 'Agent returned empty response');
      return;
    }

    await applyOutputAction(agent.outputAction, result, spinner);
    spinner = null;

    if (input.onFinalText) {
      try {
        await input.onFinalText(result);
      } catch (e) {
        await diagnosticsService.report({
          source: 'frontend',
          kind: 'silent_agent_failed',
          severity: 'warning',
          retryable: false,
          developerDetail: String(e),
          context: { message: 'onFinalText threw', agentId: input.agentId },
        });
      }
    }
  } catch (err) {
    const detail = extractErrorMessage(err);
    logService.warn(`[silent-agents] dispatch failed: ${detail}`);
    const target: Pick<AgentDef, 'id' | 'name'> = resolvedAgent
      ? { id: resolvedAgent.id, name: resolvedAgent.name }
      : { id: input.agentId, name: 'AI command' };
    if (spinner) {
      await spinner.replace(`⚠️ ${target.name} failed`, { spinning: false, durationMs: 3000 });
      spinner = null;
    }
    await reportFailure(target, detail);
  }
}

// ── Input capture ────────────────────────────────────────────────────────────

/**
 * Returns the user text to send to the LLM, or `null` when the capture
 * could not produce usable input (in which case a HUD warning is shown
 * and the dispatcher should abort silently).
 */
async function captureInput(
  source: SilentInputSource,
  overrideUserText?: string,
): Promise<string | null> {
  if (overrideUserText !== undefined && overrideUserText.length > 0) {
    return overrideUserText;
  }

  switch (source) {
    case 'selection': {
      try {
        const text = await selectionService.getSelectedText();
        if (!text || text.trim().length === 0) {
          await feedbackService.showHUD('No selection');
          return null;
        }
        return text;
      } catch (err) {
        logService.warn(`[silent-agents] selection capture failed: ${err}`);
        await feedbackService.showHUD('Could not read selection');
        return null;
      }
    }
    case 'clipboard': {
      try {
        const text = await readText();
        if (!text || text.trim().length === 0) {
          await feedbackService.showHUD('Clipboard is empty');
          return null;
        }
        return text;
      } catch (err) {
        logService.warn(`[silent-agents] clipboard capture failed: ${err}`);
        await feedbackService.showHUD('Could not read clipboard');
        return null;
      }
    }
    case 'argument': {
      // No override given — empty string is valid (lets agents whose
      // system prompt is self-contained still run).
      return '';
    }
    case 'none':
      return '';
  }
}

// ── Agent loop (ephemeral — no persistence, no runService) ────────────────────

/**
 * Single-turn LLM call (or tool loop if the agent has tools). Returns
 * the final assistant text, or `null` when cancelled mid-flight.
 */
async function runSilentAgentTurn(
  agent: AgentDef,
  userText: string,
  externalSignal?: AbortSignal,
): Promise<string | null> {
  const plugin = getProvider(agent.providerId as Parameters<typeof getProvider>[0]);
  if (!plugin) {
    throw new Error(`Provider '${agent.providerId}' is not registered`);
  }

  const settings = settingsService.getSettings();
  const config = settings.ai.providers[
    agent.providerId as keyof typeof settings.ai.providers
  ];
  if (!config?.apiKey) {
    throw new Error(`API key for provider '${agent.providerId}' is not set`);
  }

  const controller = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const isCancelled = () => controller.signal.aborted;

  const toolSelection = agent.toolSelection ?? [];
  if (toolSelection.length === 0) {
    return runTextOnlySilent(
      agent,
      plugin,
      config as ProviderConfig,
      settings,
      userText,
      controller.signal,
      isCancelled,
    );
  }
  return runToolLoopSilent(
    agent,
    plugin,
    config as ProviderConfig,
    settings,
    userText,
    toolSelection,
    controller.signal,
    isCancelled,
  );
}

async function runTextOnlySilent(
  agent: AgentDef,
  plugin: IProviderPlugin,
  config: ProviderConfig,
  settings: ReturnType<typeof settingsService.getSettings>,
  userText: string,
  signal: AbortSignal,
  isCancelled: () => boolean,
): Promise<string | null> {
  const messages: ChatMessage[] = [];
  if (agent.systemPrompt) {
    messages.push({
      id: `system-${agent.id}`,
      role: 'system',
      content: agent.systemPrompt,
      timestamp: 0,
    });
  }
  messages.push({
    id: `user-${Date.now()}`,
    role: 'user',
    content: userText,
    timestamp: Date.now(),
  });

  let accumulated = '';
  let errorMessage: string | null = null;

  await new Promise<void>((resolve, reject) => {
    streamChat(
      plugin,
      config,
      messages,
      {
        modelId: agent.modelId,
        temperature: settings.ai.temperature,
        maxTokens: settings.ai.maxTokens,
      },
      {
        onToken: (token) => {
          accumulated += token;
        },
        onDone: () => resolve(),
        onError: (msg) => {
          errorMessage = msg;
          resolve();
        },
      },
      signal,
      `silent-agent-${agent.id}-${Date.now()}`,
    ).catch(reject);
  });

  if (isCancelled()) return null;
  if (errorMessage !== null) throw new Error(errorMessage);
  return accumulated;
}

async function runToolLoopSilent(
  agent: AgentDef,
  plugin: IProviderPlugin,
  config: ProviderConfig,
  settings: ReturnType<typeof settingsService.getSettings>,
  userText: string,
  toolSelection: string[],
  signal: AbortSignal,
  isCancelled: () => boolean,
): Promise<string | null> {
  // Resolve selected tool descriptors. Anthropic rejects `:` / `.` in tool
  // names so we wire-encode the FQID and map back when handling tool_use
  // events — same logic as agentLoop.ts.
  const allDescriptors = (await agentsToolsList()) ?? [];
  const selectedDescriptors = allDescriptors.filter((d) =>
    toolSelection.includes(d.fullyQualifiedId),
  );
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

  const currentMessages: LoopMessage[] = [];
  if (agent.systemPrompt) {
    currentMessages.push({ role: 'system', content: agent.systemPrompt });
  }
  currentMessages.push({ role: 'user', content: userText });

  const params = {
    modelId: agent.modelId,
    temperature: settings.ai.temperature,
    maxTokens: settings.ai.maxTokens,
  };

  let finalText = '';

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    if (isCancelled()) return null;

    const spec = plugin.buildToolRequest(currentMessages, config, params, tools);
    if (!spec) {
      throw new Error(`Provider '${agent.providerId}' does not support tools`);
    }

    const response = await tauriFetch(spec.url, {
      method: 'POST',
      headers: spec.headers as Record<string, string>,
      body: JSON.stringify(spec.body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => `HTTP ${response.status}`);
      let humanMsg = errText;
      try {
        const parsed = JSON.parse(errText) as { error?: { message?: string } };
        if (parsed?.error?.message) humanMsg = parsed.error.message;
      } catch {
        /* keep raw text */
      }
      throw new Error(`API ${response.status}: ${humanMsg}`);
    }
    if (!response.body) {
      throw new Error('No response body received.');
    }

    const reader = response.body.getReader();
    let accumText = '';
    const toolUses: ToolCall[] = [];
    try {
      for await (const ev of plugin.parseToolStream(reader)) {
        if (isCancelled()) break;
        if (ev.type === 'text') {
          accumText += ev.text;
        } else if (ev.type === 'tool_use') {
          const resolvedFqid = wireToFqid.get(ev.name) ?? ev.name;
          toolUses.push({ id: ev.id, name: resolvedFqid, input: ev.input });
        } else if (ev.type === 'message_stop') {
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    finalText = accumText;
    const assistantLoopMsg: LoopMessage = { role: 'assistant', content: accumText };
    if (toolUses.length > 0) assistantLoopMsg.toolUse = toolUses;
    currentMessages.push(assistantLoopMsg);

    if (toolUses.length === 0) {
      return finalText;
    }

    for (const tu of toolUses) {
      const output = await invokeTool(tu.name, tu.input, agent.id);
      currentMessages.push({
        role: 'tool',
        content: JSON.stringify(output),
        toolUseId: tu.id,
      });
    }
    if (isCancelled()) return null;
  }

  throw new Error(`Silent agent loop exceeded max turns (${MAX_TOOL_TURNS})`);
}

// ── Output action ─────────────────────────────────────────────────────────────

async function applyOutputAction(
  action: SilentOutputAction,
  result: string,
  spinner: HudSpinnerHandle,
): Promise<void> {
  switch (action) {
    case 'replaceSelection':
    case 'paste':
      // The text appearing in the user's app IS the feedback — dismiss the
      // spinner so the HUD pill doesn't linger over a successful paste.
      await spinner.dismiss();
      await writeAndPaste(result);
      return;
    case 'copy':
      await writeText(result);
      await spinner.replace('✓ Copied', { spinning: false, durationMs: 1500 });
      return;
    case 'hud': {
      const line = lastNonEmptyLine(result);
      // Swap the spinner pill in place for the result line; auto-hides
      // after the default HUD duration.
      await spinner.replace(line, { spinning: false });
      return;
    }
  }
}

/**
 * Save the current clipboard, write the result, hide the launcher window
 * (no-op if it isn't visible — silent agents may be invoked from the
 * global hotkey while the launcher is closed), simulate Cmd+V, then
 * restore the clipboard after a short delay so the paste completes
 * before we overwrite the clipboard.
 *
 * The save-restore protects the user's clipboard from being trashed
 * by the agent's output — they didn't ask for "copy", they asked for
 * "paste in place".
 */
async function writeAndPaste(result: string): Promise<void> {
  let savedClipboard: string | null = null;
  try {
    savedClipboard = await readText();
  } catch {
    // Some clipboard contents (images, files) can't be read as text;
    // we still proceed but can't restore them. Acceptable trade-off.
    savedClipboard = null;
  }

  await writeText(result);

  try {
    await windowService.hide();
  } catch {
    // Hide can fail if the window isn't visible. Paste still works.
  }

  await simulatePaste();

  if (savedClipboard !== null) {
    const toRestore = savedClipboard;
    setTimeout(() => {
      void writeText(toRestore).catch(() => {
        /* clipboard restore is best-effort */
      });
    }, CLIPBOARD_RESTORE_DELAY_MS);
  }
}

/**
 * Last non-empty trimmed line in `text`, or the trimmed full text if no
 * newlines / no non-empty lines. Used by the `hud` output action.
 */
export function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.length > 0) return t;
  }
  return text.trim();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadAgent(agentId: string): Promise<AgentDef> {
  const cached = agentService.getById(agentId);
  if (cached) return cached;
  const fetched = await agentsGet(agentId);
  if (!fetched) throw new Error(`Agent '${agentId}' not found`);
  return fetched;
}

async function reportFailure(
  agent: Pick<AgentDef, 'id' | 'name'>,
  detail: string,
): Promise<void> {
  try {
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'silent_agent_failed',
      severity: 'warning',
      retryable: false,
      developerDetail: detail,
      context: { message: `${agent.name}: ${detail}`, agentId: agent.id },
    });
  } catch {
    /* diagnostics is best-effort */
  }

  try {
    await notificationService.send('agents', {
      title: agent.name,
      body: detail,
    });
  } catch (err) {
    logService.warn(`[silent-agents] notification failed: ${err}`);
  }
}
