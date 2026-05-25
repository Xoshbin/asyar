import { invoke } from '@tauri-apps/api/core';
import { dispatchSilentAgentCommand } from '../agents/silentDispatch';
import { buildEmojiFallbackAgent } from '../agents/defaultAgent';
import { agentService } from '../agents/agentService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';

export interface EmojiFallbackPayload {
  agentId: 'emoji-fallback';
  shortcode: string;
  userText: string;
  timeoutMs: number;
}

const FALLBACK_PROVIDER_ID = 'anthropic';
const FALLBACK_MODEL_ID = 'claude-haiku-4-5-20251001';

/**
 * Returns true iff `s` is exactly one emoji-class character (single Unicode
 * scalar, optionally with a single VS16 selector). Empty/multi-char/non-emoji
 * inputs return false.
 */
function isSingleEmoji(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length === 0) return false;
  const codepoints = Array.from(trimmed);
  if (codepoints.length === 0 || codepoints.length > 4) return false;
  const first = codepoints[0].codePointAt(0)!;
  if (first < 0x80) return false;
  return true;
}

export async function handleEmojiFallback(p: EmojiFallbackPayload): Promise<void> {
  const defaultAgent = agentService.getDefaultAgent();
  const providerId = defaultAgent?.providerId ?? FALLBACK_PROVIDER_ID;
  const modelId = defaultAgent?.modelId ?? FALLBACK_MODEL_ID;
  const agentDef = buildEmojiFallbackAgent(providerId, modelId);

  try {
    await dispatchSilentAgentCommand({
      agentId: p.agentId,
      agentDef,
      userText: p.userText,
      onFinalText: async (text: string) => {
        const trimmed = text.trim();
        if (isSingleEmoji(trimmed)) {
          await invoke('record_inline_emoji_fallback_outcome', {
            shortcode: p.shortcode,
            outcome: 'hit',
            emoji: trimmed,
          });
        } else {
          await invoke('record_inline_emoji_fallback_outcome', {
            shortcode: p.shortcode,
            outcome: 'miss',
            emoji: undefined,
          });
        }
      },
    });
  } catch (e) {
    await diagnosticsService.report({
      source: 'frontend',
      kind: 'silent_agent_failed',
      severity: 'warning',
      retryable: false,
      developerDetail: String(e),
      context: { message: 'inline emoji fallback failed', shortcode: p.shortcode } as never,
    });
    try {
      await invoke('record_inline_emoji_fallback_outcome', {
        shortcode: p.shortcode,
        outcome: 'miss',
        emoji: undefined,
      });
    } catch {
      // Swallow — already reported via diagnostics.
    }
  }
}
