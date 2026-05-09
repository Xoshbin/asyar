import { aiStore } from '../../built-in-features/ai-chat/aiStore.svelte';
import {
  streamChat as engineStreamChat,
  stopStream as engineStopStream,
} from './aiEngine';
import { getProvider } from './providerRegistry';
import type { AIMessage as EngineMessage } from '../../built-in-features/ai-chat/aiStore.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { logService } from '../log/logService';
import { runService } from '../run/runService.svelte';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

export type AIRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIStreamRequest {
  streamId: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
}

export class AIService {
  /**
   * Start a streaming AI chat call for an extension.
   * Returns immediately after kicking off the stream.
   * Tokens flow to the extension via StreamDispatcher.
   *
   * @throws Error with format "code: message" on validation failures.
   */
  async streamChat(extensionId: string, request: AIStreamRequest): Promise<{ streaming: true }> {
    const settings = aiStore.settings;

    // 1. Master toggle
    if (!settings.allowExtensionUse) {
      throw new Error('ai_disabled_by_user: Extension AI access is disabled in AI settings');
    }

    // 2. Configured check
    if (!aiStore.isConfigured) {
      throw new Error('ai_not_configured: No AI provider configured. Open AI settings to add an API key.');
    }

    // 3. Input validation
    if (!request?.streamId || typeof request.streamId !== 'string') {
      throw new Error('invalid_request: streamId is required');
    }
    if (!Array.isArray(request.messages) || request.messages.length === 0) {
      throw new Error('invalid_request: messages must be a non-empty array');
    }
    for (const m of request.messages) {
      if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') {
        throw new Error('invalid_request: each message must have { role: string, content: string }');
      }
    }

    // 4. Resolve active plugin
    const activeProviderId = settings.activeProviderId;
    if (!activeProviderId) {
      throw new Error('ai_not_configured: No active provider selected');
    }
    const plugin = getProvider(activeProviderId);
    if (!plugin) {
      throw new Error(`ai_not_configured: Provider '${activeProviderId}' is not registered`);
    }
    const providerConfig = settings.providers[activeProviderId];

    // 5. Clamp maxTokens to user's ceiling (cost guardrail)
    const userMax = settings.maxTokens;
    const effectiveMaxTokens =
      typeof request.maxTokens === 'number' ? Math.min(request.maxTokens, userMax) : userMax;
    const effectiveTemperature =
      typeof request.temperature === 'number' ? request.temperature : settings.temperature;

    const params = {
      modelId: settings.activeModelId ?? '',
      temperature: effectiveTemperature,
      maxTokens: effectiveMaxTokens,
      systemPrompt: settings.systemPrompt,
    };

    // 6. Create stream handle in dispatcher
    const handle = streamDispatcher.create(extensionId, request.streamId);

    // 7. Wire abort: extension abort → cancel the engine fetch
    const abortController = new AbortController();
    handle.onAbort(() => {
      engineStopStream(request.streamId);
      abortController.abort();
    });

    // 8. Convert SDK message format to engine format (engine needs id + timestamp)
    const engineMessages: EngineMessage[] = request.messages.map((m, i) => ({
      id: `ext_${request.streamId}_${i}`,
      role: m.role as EngineMessage['role'],
      content: m.content,
      timestamp: Date.now(),
    }));

    // 9. Register a Run for visibility
    const lastUserMessage = request.messages[request.messages.length - 1]?.content ?? '';
    const modelLabel = aiStore.settings.activeModelId ?? 'AI';
    const runLabel = `${modelLabel}: ${lastUserMessage.slice(0, 60)}`;
    let runHandle: Awaited<ReturnType<typeof runService.startLocal>> | null = null;
    let unsubscribeCancel: (() => void) | null = null;
    try {
      runHandle = await runService.startLocal({
        label: runLabel,
        kind: 'ai-chat',
        cancellable: true,
        extensionId,
      });
      unsubscribeCancel = runHandle.onCancel(() => {
        abortController.abort();
      });
    } catch (err) {
      logService.warn(`[AIService] runService.startLocal failed: ${err instanceof Error ? err.message : String(err)}`);
      diagnosticsService.report({
        kind: 'run_failed',
        severity: 'warning',
        retryable: false,
        source: 'frontend',
        context: { runId: 'ai-chat-start-failed' },
      });
    }

    // 10. Fire engine stream — NOT awaited (returns immediately, tokens stream in background)
    engineStreamChat(
      plugin,
      providerConfig,
      engineMessages,
      params,
      {
        onToken: (token) => {
          handle.sendChunk({ token });
          void runHandle?.write(token).catch(() => {});
        },
        onDone: () => {
          handle.sendDone();
          void runHandle?.done().then(() => { unsubscribeCancel?.(); }).catch(() => {});
        },
        onError: (err) => {
          handle.sendError({ code: 'provider_error', message: err });
          void runHandle?.fail(err).then(() => { unsubscribeCancel?.(); }).catch(() => {});
        },
      },
      abortController.signal,
      request.streamId,
    ).catch((err) => {
      logService.error(`[AIService] engine stream threw unexpectedly: ${err}`);
      const message = err instanceof Error ? err.message : String(err);
      handle.sendError({
        code: 'internal_error',
        message,
      });
      void runHandle?.fail(message).then(() => { unsubscribeCancel?.(); }).catch(() => {});
    });

    // 11. Return ack — router sends this as the initial asyar:response
    return { streaming: true };
  }
}

export const aiExtensionService = new AIService();
