import { BaseServiceProxy } from './BaseServiceProxy';
import type { IOAuthService, OAuthConfig, OAuthToken, OAuthError } from './IOAuthService';

/**
 * SDK proxy for the OAuthService.
 *
 * Mirrors the AIServiceProxy "fire-and-forget" pattern:
 * - Registers a window message listener BEFORE calling broker.invoke() to
 *   prevent a race condition where the result arrives before we are listening.
 * - broker.invoke() returns either a cached OAuthToken (resolve immediately)
 *   or { pending: true } (wait for 'asyar:oauth:result' postMessage from host).
 *
 * Requires `oauth:use` manifest permission.
 */
export class OAuthServiceProxy extends BaseServiceProxy implements IOAuthService {
  authorize(config: OAuthConfig): Promise<OAuthToken> {
    return new Promise<OAuthToken>((resolve, reject) => {
      // crypto.randomUUID is available in modern browsers and in Tauri WebViews.
      const flowId = crypto.randomUUID();

      const handler = (event: MessageEvent) => {
        const msg = event.data;
        if (msg?.type !== 'asyar:oauth:result') return;
        if (msg?.flowId !== flowId) return;

        window.removeEventListener('message', handler);

        if (msg.error) {
          const err = msg.error as OAuthError;
          reject(new Error(`OAuth error [${err.code}]: ${err.message}`));
        } else {
          resolve(msg.token as OAuthToken);
        }
      };

      // Register BEFORE invoke — prevents race condition where deep-link
      // callback resolves synchronously before the listener is attached.
      window.addEventListener('message', handler);

      this.broker
        .invoke<OAuthToken | { pending: true }>(
          'oauth:authorize',
          {
            // Key insertion order must match Object.values() dispatch in IpcRouter,
            // which maps to host service parameter order after extensionId injection:
            // authorize(extensionId, providerId, clientId, authorizationUrl, tokenUrl, scopes, flowId)
            providerId: config.providerId,
            clientId: config.clientId,
            authorizationUrl: config.authorizationUrl,
            tokenUrl: config.tokenUrl,
            scopes: config.scopes,
            flowId,
          },
        )
        .then((result) => {
          if ('accessToken' in result) {
            // Host returned a cached token directly — no postMessage needed
            window.removeEventListener('message', handler);
            resolve(result as OAuthToken);
          }
          // If { pending: true }, keep the listener active and wait
        })
        .catch((err) => {
          window.removeEventListener('message', handler);
          reject(err);
        });
    });
  }

  revokeToken(providerId: string): Promise<void> {
    return this.broker.invoke('oauth:revokeToken', { providerId });
  }
}
