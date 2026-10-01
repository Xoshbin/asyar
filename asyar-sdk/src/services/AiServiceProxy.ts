import { BaseServiceProxy } from './BaseServiceProxy';
import type { IAiService, AiCompletionOptions, AiStreamOptions } from '../contracts/IAiService';

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
}
