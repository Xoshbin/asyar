import { BaseServiceProxy } from './BaseServiceProxy';
import {
  IAIService,
  AIStreamParams,
  AIStreamHandlers,
  AIStreamHandle,
  AIErrorCode,
  AIError,
} from './IAIService';

const KNOWN_CODES: AIErrorCode[] = [
  'ai_not_configured',
  'ai_disabled_by_user',
  'provider_error',
  'invalid_request',
  'internal_error',
  'aborted',
];

export class AIServiceProxy extends BaseServiceProxy implements IAIService {
  stream(params: AIStreamParams, handlers: AIStreamHandlers): AIStreamHandle {
    const streamId = crypto.randomUUID();
    let settled = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
    };

    const settle = (error?: AIError) => {
      if (settled) return;
      settled = true;
      cleanup();

      if (error) {
        handlers.onError(error);
      } else {
        handlers.onDone();
      }
    };

    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type !== 'asyar:stream' || msg?.streamId !== streamId) {
        return;
      }

      const { phase, data } = msg;

      switch (phase) {
        case 'chunk':
          if (data?.token) {
            handlers.onToken(data.token);
          }
          break;
        case 'done':
          settle();
          break;
        case 'error':
          {
            const code = data?.error?.code;
            const message = data?.error?.message || 'Unknown stream error';
            settle({
              code: KNOWN_CODES.includes(code as AIErrorCode)
                ? (code as AIErrorCode)
                : 'internal_error',
              message,
            });
          }
          break;
      }
    };

    // Register listener BEFORE invoking to avoid races
    window.addEventListener('message', onMessage);

    this.broker
      .invoke('asyar:service:AIService:streamChat', {
        ...params,
        streamId,
      })
      .catch((err) => {
        const errorStr = String(err.message || err);
        const match = errorStr.match(/^(\w+):\s*(.*)$/);
        
        if (match) {
          const [, code, message] = match;
          settle({
            code: KNOWN_CODES.includes(code as AIErrorCode)
              ? (code as AIErrorCode)
              : 'internal_error',
            message,
          });
        } else {
          settle({
            code: 'internal_error',
            message: errorStr,
          });
        }
      });

    return {
      abort: () => {
        if (settled) return;
        window.parent.postMessage(
          {
            type: 'asyar:stream:abort',
            streamId,
          },
          '*'
        );
        settle({ code: 'aborted', message: 'Stream was aborted by the extension' });
      },
    };
  }
}
