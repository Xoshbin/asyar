import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEmojiFallback, type EmojiFallbackPayload } from './inlineEmojiFallback';
import { dispatchSilentAgentCommand } from '../agents/silentDispatch';
import { invoke } from '@tauri-apps/api/core';

vi.mock('../agents/silentDispatch');
vi.mock('@tauri-apps/api/core');
vi.mock('../../services/run/runService.svelte', () => ({
  runService: { startLocal: vi.fn() },
}));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../agents/agentService.svelte', () => ({
  agentService: {
    getDefaultAgent: vi.fn(() => ({
      id: 'default-agent',
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    })),
  },
}));

vi.mock('../../services/diagnostics/diagnosticsService.svelte', () => ({
  diagnosticsService: { report: vi.fn().mockResolvedValue(undefined) },
}));

const SAMPLE: EmojiFallbackPayload = {
  agentId: 'emoji-fallback',
  shortcode: ':burnout:',
  userText: 'burnout',
  timeoutMs: 1500,
};

describe('handleEmojiFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('dispatches the emoji-fallback agent with userText set to the inner word', async () => {
    (dispatchSilentAgentCommand as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await handleEmojiFallback(SAMPLE);
    expect(dispatchSilentAgentCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'emoji-fallback',
        userText: 'burnout',
        agentDef: expect.objectContaining({ id: 'emoji-fallback' }),
        onFinalText: expect.any(Function),
      }),
    );
  });

  it('records hit outcome when agent returns a single emoji character', async () => {
    let captured: ((t: string) => Promise<void>) | undefined;
    (dispatchSilentAgentCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      captured = input.onFinalText;
    });
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await handleEmojiFallback(SAMPLE);
    expect(captured).toBeDefined();
    await captured!('🎉');

    expect(invoke).toHaveBeenCalledWith('record_inline_emoji_fallback_outcome', {
      shortcode: ':burnout:',
      outcome: 'hit',
      emoji: '🎉',
    });
  });

  it('records miss outcome when agent returns empty string', async () => {
    let captured: ((t: string) => Promise<void>) | undefined;
    (dispatchSilentAgentCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      captured = input.onFinalText;
    });
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await handleEmojiFallback(SAMPLE);
    await captured!('');

    expect(invoke).toHaveBeenCalledWith('record_inline_emoji_fallback_outcome', {
      shortcode: ':burnout:',
      outcome: 'miss',
      emoji: undefined,
    });
  });

  it('records miss outcome when agent returns whitespace or non-emoji text', async () => {
    let captured: ((t: string) => Promise<void>) | undefined;
    (dispatchSilentAgentCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => {
      captured = input.onFinalText;
    });
    (invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

    await handleEmojiFallback(SAMPLE);
    await captured!('  no idea  ');

    expect(invoke).toHaveBeenCalledWith('record_inline_emoji_fallback_outcome', {
      shortcode: ':burnout:',
      outcome: 'miss',
      emoji: undefined,
    });
  });
});
