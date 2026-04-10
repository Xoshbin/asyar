import { aiStore } from '../../built-in-features/ai-chat/aiStore.svelte';
import {
  streamChat as engineStreamChat,
  stopStream as engineStopStream,
} from './aiEngine';
import { getProvider } from './providerRegistry';
import type { AIMessage as EngineMessage } from '../../built-in-features/ai-chat/aiStore.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { logService } from '../log/logService';

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

    // 9. Fire engine stream — NOT awaited (returns immediately, tokens stream in background)
    engineStreamChat(
      plugin,
      providerConfig,
      engineMessages,
      params,
      {
        onToken: (token) => handle.sendChunk({ token }),
        onDone: () => handle.sendDone(),
        onError: (err) => handle.sendError({ code: 'provider_error', message: err }),
      },
      abortController.signal,
      request.streamId,
    ).catch((err) => {
      logService.error(`[AIService] engine stream threw unexpectedly: ${err}`);
      handle.sendError({
        code: 'internal_error',
        message: err instanceof Error ? err.message : String(err),
      });
    });

    // 10. Return ack — router sends this as the initial asyar:response
    return { streaming: true };
  }
}

export const aiExtensionService = new AIService();
