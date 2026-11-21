import {
  agentsCancelRun,
  agentsGet,
  agentsRunSilent,
  aiGetCredentialStatus,
  aiListModels,
  toAgentProviderDescriptors,
  type AgentRunConfig,
} from '../../lib/ipc/commands';
import { providerRegistry } from './providerRegistry';
import { settingsService } from '../settings/settingsService.svelte';
import { streamDispatcher } from '../extension/streamDispatcher.svelte';
import { createAgentStreamChannel } from '../../built-in-features/agents/agentStreamBridge';
import { providerOptions } from '../../built-in-features/agents/modelCatalog.svelte';
import { extractErrorMessage } from '../../lib/errors';
import {
  isValidAiModelRef,
  type AiCompletionOptions,
  type AiConfiguredModel,
  type AiModelRef,
  type AiStreamOptions,
} from 'asyar-sdk/contracts';

function normalizeModelOverride(model: unknown): AiModelRef | null {
  if (model === undefined || model === null) return null;
  if (!isValidAiModelRef(model)) {
    throw new Error(
      'AI model override must be an object with non-empty providerId and modelId strings',
    );
  }
  return { providerId: model.providerId.trim(), modelId: model.modelId.trim() };
}

export class AiService {
  async listModels(_extensionId?: string): Promise<AiConfiguredModel[]> {
    const settings = settingsService.getSettings();
    const providers = settings.ai.providers ?? {};
    const plugins = providerRegistry.list();
    const defaultAgentId = settings.ai.defaultAgentId ?? '';

    const [credResult, agentResult] = await Promise.allSettled([
      aiGetCredentialStatus(),
      defaultAgentId ? agentsGet(defaultAgentId) : Promise.resolve(null),
    ]);

    const credentialStates =
      credResult.status === 'fulfilled' ? (credResult.value?.providers ?? null) : null;
    const defaultAgent = agentResult.status === 'fulfilled' ? agentResult.value : null;

    const runnableProviders = providerOptions(providers, plugins, credentialStates);
    if (runnableProviders.length === 0) {
      return [];
    }

    const perProviderResults = await Promise.allSettled(
      runnableProviders.map(async (provider) => {
        const config = providers[provider.id];
        if (!config) return [];

        const models = await aiListModels(provider.id, config);
        const seenModelIds = new Set<string>();
        return models.reduce<AiConfiguredModel[]>((acc, m) => {
          if (seenModelIds.has(m.id)) return acc;
          seenModelIds.add(m.id);
          acc.push({
            providerId: provider.id,
            providerName: provider.label,
            modelId: m.id,
            label: m.label,
            isDefault:
              defaultAgent !== null &&
              defaultAgent.providerId === provider.id &&
              defaultAgent.modelId === m.id,
          });
          return acc;
        }, []);
      }),
    );

    const combined: AiConfiguredModel[] = [];
    for (const settled of perProviderResults) {
      if (settled.status === 'fulfilled') {
        combined.push(...settled.value);
      }
    }

    return combined;
  }

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

    const modelOverride = normalizeModelOverride(options?.model);

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
      ...(modelOverride
        ? {
            providerOverrideId: modelOverride.providerId,
            modelOverrideId: modelOverride.modelId,
          }
        : {}),
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

    const modelOverride = normalizeModelOverride(options?.model);

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
      ...(modelOverride
        ? {
            providerOverrideId: modelOverride.providerId,
            modelOverrideId: modelOverride.modelId,
          }
        : {}),
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
