/**
 * Silent agent browser adapter.
 *
 * Rust owns the ephemeral agent loop. Svelte retains only the operations that
 * require browser or OS access: capturing input, dispatching extension iframe
 * tools through the shared stream bridge, and applying the output action.
 */
import { readText, writeText } from 'tauri-plugin-clipboard-x-api';
import { extractErrorMessage } from '../../lib/errors';
import {
  agentsCancelRun,
  agentsGet,
  agentsRunSilent,
  simulatePaste,
  toAgentProviderDescriptors,
} from '../../lib/ipc/commands';
import { providerRegistry } from '../../services/ai/providerRegistry';
import {
  feedbackService,
  type HudSpinnerHandle,
} from '../../services/feedback/feedbackService.svelte';
import { logService } from '../../services/log/logService';
import { selectionService } from '../../services/selection/selectionService';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { windowService } from '../../services/window/windowService';
import { agentService } from './agentService.svelte';
import { listenToAgentStream } from './agentStreamBridge';
import type { AgentDef, SilentInputSource, SilentOutputAction } from './types';

const CLIPBOARD_RESTORE_DELAY_MS = 200;

interface SilentDispatchOptions {
  userText?: string;
  rawInputLength?: number;
  abortSignal?: AbortSignal;
  onFinalText?: (text: string) => void | Promise<void>;
}

export interface SilentDispatchInput extends SilentDispatchOptions {
  agentId: string;
}

/** Agent id -> the controller driving its currently in-flight silent run. */
const activeRuns = new Map<string, AbortController>();

/**
 * Runs a silent command without creating a thread or a tracked Run. Failures
 * are surfaced through diagnostics because hotkey callers cannot render a
 * rejected promise.
 *
 * A repeat trigger for the same agent (hotkey pressed again, shortcode
 * retyped) while a run is still in flight cancels that run instead of
 * stacking a second one — otherwise a slow or stuck call had no way to be
 * interrupted short of force-quitting the app.
 */
export async function dispatchSilentAgentCommand(input: SilentDispatchInput): Promise<void> {
  const inFlight = activeRuns.get(input.agentId);
  if (inFlight) {
    inFlight.abort();
    return;
  }

  const controller = new AbortController();
  if (input.abortSignal) {
    if (input.abortSignal.aborted) controller.abort();
    else input.abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  activeRuns.set(input.agentId, controller);
  try {
    await runSilentAgentCommand({ ...input, abortSignal: controller.signal });
  } finally {
    if (activeRuns.get(input.agentId) === controller) {
      activeRuns.delete(input.agentId);
    }
  }
}

async function runSilentAgentCommand(input: SilentDispatchInput): Promise<void> {
  if (input.abortSignal?.aborted) return;

  let resolvedAgent: AgentDef | null = null;
  let spinner: HudSpinnerHandle | null = null;
  let unlisten: (() => void) | undefined;
  let removeAbortListener: (() => void) | undefined;

  try {
    const settings = settingsService.getSettings();
    const agent = await loadAgent(input.agentId);
    resolvedAgent = agent;

    spinner = feedbackService.showHUDSpinning(`✨ ${agent.name}…`);
    const userText = await captureInput(agent.inputSource, input.userText);
    if (userText === null) {
      // The capture warning replaces the spinner HUD.
      spinner = null;
      return;
    }

    const streamId = `silent-agent-${agent.id}-${crypto.randomUUID()}`;
    const runConfig = {
      providers: toAgentProviderDescriptors(providerRegistry.list()),
      configs: settings.ai.providers,
      defaultAgentId: settings.ai.defaultAgentId,
      temperature: settings.ai.temperature,
      maxTokens: settings.ai.maxTokens,
    };
    let bridgeError: Error | null = null;
    unlisten = await listenToAgentStream({
      streamId,
      agentId: agent.id,
      onBridgeError: (error) => {
        bridgeError = error;
      },
    });

    const onAbort = (): void => {
      void agentsCancelRun(streamId).catch(() => undefined);
    };
    input.abortSignal?.addEventListener('abort', onAbort, { once: true });
    removeAbortListener = () => input.abortSignal?.removeEventListener('abort', onAbort);
    if (input.abortSignal?.aborted) {
      onAbort();
      await spinner.dismiss();
      spinner = null;
      return;
    }

    const result = await agentsRunSilent(agent.id, userText, runConfig, streamId);
    if (bridgeError) throw bridgeError;
    if (input.abortSignal?.aborted) {
      await spinner.dismiss();
      spinner = null;
      return;
    }

    if (result.trim().length === 0) {
      if (input.onFinalText) {
        await spinner.dismiss();
        spinner = null;
        await callFinalText(input, '');
        return;
      }
      await spinner.replace('⚠️ Empty response', { spinning: false, durationMs: 3000 });
      spinner = null;
      await reportFailure(agent, 'Agent returned empty response');
      return;
    }

    await applyOutputAction(
      agent.outputAction,
      result,
      spinner,
      agent.inputSource,
      userText,
      input.rawInputLength,
    );
    spinner = null;
    await callFinalText(input, result);
  } catch (cause) {
    if (input.abortSignal?.aborted) {
      if (spinner) await spinner.dismiss();
      spinner = null;
      return;
    }

    const detail = extractErrorMessage(cause);
    logService.warn(`[silent-agents] dispatch failed: ${detail}`);
    const errorTarget: Pick<AgentDef, 'id' | 'name'> = resolvedAgent
      ? { id: resolvedAgent.id, name: resolvedAgent.name }
      : { id: input.agentId, name: 'AI command' };
    if (spinner) {
      await spinner.replace(`⚠️ ${errorTarget.name} failed`, { spinning: false, durationMs: 3000 });
      spinner = null;
    }
    await reportFailure(errorTarget, detail);
  } finally {
    removeAbortListener?.();
    unlisten?.();
  }
}

async function callFinalText(input: SilentDispatchInput, text: string): Promise<void> {
  if (!input.onFinalText) return;
  try {
    await input.onFinalText(text);
  } catch (cause) {
    await feedbackService.report({
      source: 'frontend',
      kind: 'silent_agent_failed',
      severity: 'warning',
      retryable: false,
      developerDetail: String(cause),
      context: {
        message: text.length === 0 ? 'onFinalText threw on empty result' : 'onFinalText threw',
        agentId: input.agentId,
      },
    });
  }
}

async function captureInput(
  source: SilentInputSource,
  overrideUserText?: string,
): Promise<string | null> {
  if (overrideUserText !== undefined && overrideUserText.length > 0) return overrideUserText;

  switch (source) {
    case 'selection':
      try {
        const text = await selectionService.getSelectedText();
        if (!text || text.trim().length === 0) {
          await feedbackService.showHUD('No selection');
          return null;
        }
        return text;
      } catch (cause) {
        logService.warn(`[silent-agents] selection capture failed: ${cause}`);
        await feedbackService.showHUD('Could not read selection');
        return null;
      }
    case 'clipboard':
      try {
        const text = await readText();
        if (!text || text.trim().length === 0) {
          await feedbackService.showHUD('Clipboard is empty');
          return null;
        }
        return text;
      } catch (cause) {
        logService.warn(`[silent-agents] clipboard capture failed: ${cause}`);
        await feedbackService.showHUD('Could not read clipboard');
        return null;
      }
    case 'argument':
    case 'none':
    case 'shortcodeMiss':
      // For shortcodeMiss, the input text is supplied externally via
      // SilentDispatchOptions.userText and has already been passed as the
      // overrideUserText argument; fall through to the empty-string default
      // so a missing override doesn't block dispatch.
      return overrideUserText?.length ? overrideUserText : '';
  }
}

async function applyOutputAction(
  action: SilentOutputAction,
  result: string,
  spinner: HudSpinnerHandle,
  inputSource?: SilentInputSource,
  userText?: string,
  rawInputLength?: number,
): Promise<void> {
  if (inputSource === 'shortcodeMiss' && userText) {
    await spinner.dismiss();
    const { snippetService } = await import('../snippets/snippetService');
    const deleteLen = rawInputLength ?? userText.length + 2;
    await snippetService.expandSnippet(deleteLen, result);
    return;
  }

  switch (action) {
    case 'replaceSelection':
    case 'paste':
      await spinner.dismiss();
      await writeAndPaste(result);
      return;
    case 'copy':
      await writeText(result);
      await spinner.replace('✓ Copied', { spinning: false, durationMs: 1500 });
      return;
    case 'hud':
      await spinner.replace(lastNonEmptyLine(result), { spinning: false });
  }
}

async function writeAndPaste(result: string): Promise<void> {
  let savedClipboard: string | null = null;
  try {
    savedClipboard = await readText();
  } catch {
    // Non-text clipboard data cannot be restored through this API.
  }

  await writeText(result);
  try {
    await windowService.hide();
  } catch {
    // The launcher may already be hidden for a global-hotkey invocation.
  }
  await simulatePaste();

  if (savedClipboard !== null) {
    setTimeout(() => {
      void writeText(savedClipboard).catch(() => undefined);
    }, CLIPBOARD_RESTORE_DELAY_MS);
  }
}

export function lastNonEmptyLine(text: string): string {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.length > 0) return line;
  }
  return text.trim();
}

async function loadAgent(agentId: string): Promise<AgentDef> {
  const cached = agentService.getById(agentId);
  if (cached) return cached;
  const fetched = await agentsGet(agentId);
  if (!fetched) throw new Error(`Agent '${agentId}' not found`);
  return fetched;
}

async function reportFailure(agent: Pick<AgentDef, 'id' | 'name'>, detail: string): Promise<void> {
  try {
    await feedbackService.report({
      source: 'frontend',
      kind: 'silent_agent_failed',
      severity: 'warning',
      retryable: false,
      developerDetail: detail,
      context: { message: `${agent.name}: ${detail}`, agentId: agent.id },
    });
  } catch {
    // Diagnostics are best-effort for background hotkey commands.
  }

  try {
    await feedbackService.sendBackgroundForSource('agents', {
      title: agent.name,
      body: detail,
    });
  } catch (cause) {
    logService.warn(`[silent-agents] notification failed: ${cause}`);
  }
}
