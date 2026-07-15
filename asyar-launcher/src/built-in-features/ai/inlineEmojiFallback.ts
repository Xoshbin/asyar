import { recordInlineEmojiFallbackOutcome } from '../../lib/ipc/shortcodeCommands';
import { dispatchSilentAgentCommand } from '../agents/silentDispatch';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';

export interface EmojiFallbackPayload {
  agentId: 'emoji-fallback';
  shortcode: string;
  userText: string;
  timeoutMs: number;
}

export async function handleEmojiFallback(p: EmojiFallbackPayload): Promise<void> {
  try {
    await dispatchSilentAgentCommand({
      builtinProfile: 'inline_emoji',
      userText: p.userText,
      onFinalText: async (text: string) => {
        await recordInlineEmojiFallbackOutcome(p.shortcode, text);
      },
    });
  } catch (e) {
    await feedbackService.report({
      source: 'frontend',
      kind: 'silent_agent_failed',
      severity: 'warning',
      retryable: false,
      developerDetail: String(e),
      context: { message: 'inline emoji fallback failed', shortcode: p.shortcode } as never,
    });
    await recordInlineEmojiFallbackOutcome(p.shortcode, '');
  }
}
