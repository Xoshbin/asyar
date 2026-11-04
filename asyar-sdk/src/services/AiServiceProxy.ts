import { BaseServiceProxy } from './BaseServiceProxy';
import type { IAiService, AiCompletionOptions, AiStreamOptions } from '../contracts/IAiService';
import type {
  WebSearchEngineRegistration,
  WebSearchHandler,
  WebSearchQuery,
  WebSearchResult,
} from '../contracts/webSearch';
import type {
  AiProviderRegistration,
  AiCompletionRequest,
  AiStreamChunk,
  AiModelInfo,
  AiProviderConfig,
} from '../contracts/aiProvider';

/**
 * SDK proxy for the AI prompting service.
 * Allows Tier 2 extensions to prompt the host's configured AI model
 * for one-shot completions or streamed responses without direct provider configuration.
 */
export class AiServiceProxy extends BaseServiceProxy implements IAiService {
  async complete(prompt: string, options?: AiCompletionOptions): Promise<string> {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Operation was aborted');
    }

    const invokePromise = this.broker.invoke<string>('ai:complete', {
      prompt,
      options,
    });

    if (!options?.signal) {
      const res = await invokePromise;
      return res ?? '';
    }

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        reject(options.signal?.reason ?? new Error('Operation was aborted'));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });

      invokePromise
        .then((res) => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve(res ?? '');
        })
        .catch((err) => {
          options.signal?.removeEventListener('abort', onAbort);
          reject(err);
        });
    });
  }

  async stream(
    prompt: string,
    onChunk: (delta: string) => void,
    options?: AiStreamOptions,
  ): Promise<string> {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error('Operation was aborted');
    }

    const streamId = crypto.randomUUID();
    let settled = false;
    let accumulated = '';

    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('message', onMessage);
        }
        if (options?.signal) {
          options.signal.removeEventListener('abort', onAbort);
        }
      };

      const settle = (err?: unknown, result?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) {
          reject(err);
        } else {
          resolve(result ?? accumulated);
        }
      };

      const onAbort = () => {
        if (typeof window !== 'undefined' && window.parent) {
          window.parent.postMessage(
            {
              type: 'asyar:stream:abort',
              streamId,
            },
            '*',
          );
        }
        settle(options?.signal?.reason ?? new Error('Operation was aborted'));
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const onMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.streamId !== streamId) return;

        if (msg.type === 'asyar:stream') {
          const { phase, data } = msg;
          if (phase === 'chunk') {
            const delta =
              typeof data === 'string' ? data : typeof data?.delta === 'string' ? data.delta : '';
            if (delta) {
              accumulated += delta;
              try {
                onChunk(delta);
              } catch (e) {
                console.error('[AiServiceProxy] onChunk callback threw:', e);
              }
            }
          } else if (phase === 'done') {
            settle(undefined, accumulated);
          } else if (phase === 'error') {
            const errorMsg =
              data?.error?.message ||
              (typeof data?.error === 'string' ? data.error : 'AI stream error');
            settle(new Error(errorMsg));
          }
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('message', onMessage);
      }

      this.broker
        .invoke<string>('ai:streamChat', {
          prompt,
          streamId,
          options,
        })
        .then((fullText) => {
          settle(undefined, fullText ?? accumulated);
        })
        .catch((err) => {
          settle(err);
        });
    });
  }

  private webSearchEngines = new Map<string, WebSearchHandler>();

  registerWebSearchEngine(engine: WebSearchEngineRegistration): () => void {
    if (
      !engine ||
      typeof engine.id !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(engine.id) ||
      typeof engine.search !== 'function'
    ) {
      throw new Error(
        '[asyar-sdk/ai] registerWebSearchEngine requires an engine with a valid id and search function',
      );
    }
    this.webSearchEngines.set(engine.id, engine.search);
    return () => {
      this.webSearchEngines.delete(engine.id);
    };
  }

  async invokeWebSearchHandler(
    engineId: string,
    query: WebSearchQuery,
    signal: AbortSignal,
  ): Promise<WebSearchResult> {
    if (typeof engineId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(engineId)) {
      throw new Error(`[asyar-sdk/ai] Invalid engine ID: "${engineId}"`);
    }
    if (!this.webSearchEngines.has(engineId)) {
      throw new Error(`[asyar-sdk/ai] No search handler registered for engine: "${engineId}"`);
    }
    const handler = this.webSearchEngines.get(engineId);
    if (typeof handler !== 'function') {
      throw new Error(`[asyar-sdk/ai] Invalid handler for engine: "${engineId}"`);
    }
    return handler(query, signal);
  }

  private aiProviders = new Map<string, AiProviderRegistration>();

  registerAiProvider(provider: AiProviderRegistration): () => void {
    if (
      !provider ||
      typeof provider.id !== 'string' ||
      !/^[a-z0-9_-]{1,64}$/.test(provider.id) ||
      typeof provider.completeStream !== 'function' ||
      (provider.listModels !== undefined && typeof provider.listModels !== 'function')
    ) {
      throw new Error(
        '[asyar-sdk/ai] registerAiProvider requires a provider with a valid id and completeStream function',
      );
    }
    this.aiProviders.set(provider.id, provider);
    return () => {
      this.aiProviders.delete(provider.id);
    };
  }

  async invokeAiProviderStream(
    providerId: string,
    request: AiCompletionRequest,
    onChunk: (chunk: AiStreamChunk) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (typeof providerId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(providerId)) {
      throw new Error(`[asyar-sdk/ai] Invalid provider ID: "${providerId}"`);
    }
    const provider = this.aiProviders.get(providerId);
    if (!provider) {
      throw new Error(`[asyar-sdk/ai] No AI provider registered with ID: "${providerId}"`);
    }
    return provider.completeStream(request, onChunk, signal);
  }

  async invokeAiProviderListModels(
    providerId: string,
    config: AiProviderConfig,
    signal: AbortSignal,
  ): Promise<AiModelInfo[]> {
    if (typeof providerId !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(providerId)) {
      throw new Error(`[asyar-sdk/ai] Invalid provider ID: "${providerId}"`);
    }
    const provider = this.aiProviders.get(providerId);
    if (!provider) {
      throw new Error(`[asyar-sdk/ai] No AI provider registered with ID: "${providerId}"`);
    }
    if (typeof provider.listModels !== 'function') {
      return [];
    }
    return provider.listModels(config, signal);
  }
}
