import {
  agentsCancelRun,
  agentsRunSilent,
  toAgentProviderDescriptors,
  type AgentRunConfig,
} from '../../lib/ipc/commands';
import { providerRegistry } from './providerRegistry';
import { settingsService } from '../settings/settingsService.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { createAgentStreamChannel } from '../../built-in-features/agents/agentStreamBridge';
import { extractErrorMessage } from '../../lib/errors';
import type { AiCompletionOptions, AiStreamOptions } from 'asyar-sdk/contracts';

export class AiService {
  async complete(
    extensionIdOrPrompt: string,
    promptOrOptions?: string | AiCompletionOptions,
    maybeOptions?: AiCompletionOptions,
  ): Promise<string> {
    let prompt: string;
    let options: AiCompletionOptions | undefined;

    if (typeof promptOrOptions === 'string') {
      prompt = promptOrOptions;
      options = maybeOptions;
    } else {
      prompt = extensionIdOrPrompt;
      options = promptOrOptions;
    }

    const settings = settingsService.getSettings();
    const defaultAgentId = settings.ai.defaultAgentId ?? '';
    const userText = options?.systemPrompt
      ? `System instructions: ${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const runConfig: AgentRunConfig = {
      providers: toAgentProviderDescriptors(providerRegistry.list()),
      configs: settings.ai.providers,
      defaultAgentId,
      temperature: options?.temperature ?? null,
      maxTokens: options?.maxTokens ?? settings.ai.maxTokens,
    };

    const streamId = `ai-complete-${crypto.randomUUID()}`;
    const stream = createAgentStreamChannel({
      streamId,
      agentId: defaultAgentId,
    });

    try {
      const result = await agentsRunSilent(
        defaultAgentId,
        userText,
        runConfig,
        streamId,
        stream.channel,
      );
      return result;
    } finally {
      stream.dispose();
    }
  }

  async streamChat(
    extensionIdOrPrompt: string,
    promptOrStreamId: string,
    streamIdOrOptions?: string | AiStreamOptions,
    optionsOrRole?: AiStreamOptions | 'view' | 'worker',
    maybeRole?: 'view' | 'worker',
  ): Promise<string> {
    let extensionId: string | undefined;
    let prompt: string;
    let streamId: string;
    let options: AiStreamOptions | undefined;
    let originRole: 'view' | 'worker' | undefined;

    if (typeof streamIdOrOptions === 'string') {
      extensionId = extensionIdOrPrompt;
      prompt = promptOrStreamId;
      streamId = streamIdOrOptions;
      options = typeof optionsOrRole === 'object' ? optionsOrRole : undefined;
      originRole = typeof optionsOrRole === 'string' ? optionsOrRole : maybeRole;
    } else {
      prompt = extensionIdOrPrompt;
      streamId = promptOrStreamId;
      options = streamIdOrOptions;
      originRole = typeof optionsOrRole === 'string' ? optionsOrRole : undefined;
    }

    if (!streamId) {
      streamId = `ai-stream-${crypto.randomUUID()}`;
    }

    const streamHandle = extensionId
      ? streamDispatcher.create(extensionId, streamId, originRole)
      : null;

    streamHandle?.onAbort(() => {
      void agentsCancelRun(streamId).catch(() => undefined);
    });

    const settings = settingsService.getSettings();
    const defaultAgentId = settings.ai.defaultAgentId ?? '';
    const userText = options?.systemPrompt
      ? `System instructions: ${options.systemPrompt}\n\n${prompt}`
      : prompt;

    const runConfig: AgentRunConfig = {
      providers: toAgentProviderDescriptors(providerRegistry.list()),
      configs: settings.ai.providers,
      defaultAgentId,
      temperature: options?.temperature ?? null,
      maxTokens: options?.maxTokens ?? settings.ai.maxTokens,
    };

    const stream = createAgentStreamChannel({
      streamId,
      agentId: defaultAgentId,
      onEvent: (event) => {
        if (event.type === 'text_delta') {
          streamHandle?.sendChunk({ delta: event.delta, accumulated: event.accumulated });
        } else if (event.type === 'error') {
          streamHandle?.sendError({ code: 'AI_STREAM_ERROR', message: event.message });
        }
      },
      onBridgeError: (error) => {
        streamHandle?.sendError({ code: 'AI_STREAM_ERROR', message: error.message });
      },
    });

    try {
      const result = await agentsRunSilent(
        defaultAgentId,
        userText,
        runConfig,
        streamId,
        stream.channel,
      );
      streamHandle?.sendDone();
      return result;
    } catch (cause) {
      const message = extractErrorMessage(cause);
      streamHandle?.sendError({ code: 'AI_STREAM_ERROR', message });
      throw cause;
    } finally {
      stream.dispose();
    }
  }
}

export const aiService = new AiService();
