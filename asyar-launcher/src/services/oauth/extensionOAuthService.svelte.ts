import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { logService } from '../log/logService';
import { getExtensionFrameOrigin } from '../../lib/ipc/extensionOrigin';
import * as commands from '../../lib/ipc/commands';
import type { OAuthTokenPayload } from '../../lib/ipc/commands';

export class ExtensionOAuthService {
  /**
   * Maps the opaque state param → {extensionId, flowId} so that errors arriving
   * via deep link can be routed to the right iframe even though Rust has already
   * cleared the pending flow on exchange success.
   */
  private _pendingFlows = new Map<string, { extensionId: string; flowId: string }>();

  /** Set up the deep-link listener for asyar://oauth/callback. Call once at app init. */
  async init(): Promise<void> {
    await listen<string>('asyar:deep-link', async (event) => {
      const url = event.payload;
      if (!url.startsWith('asyar://oauth/callback')) return;
      await this._handleCallback(url);
    });
  }

  /**
   * Begin an OAuth PKCE flow for an extension.
   *
   * Called by ExtensionIpcRouter with extensionId injected as the first arg.
   * Payload key order in OAuthServiceProxy must match the parameter order here
   * (after extensionId): providerId, clientId, authorizationUrl, tokenUrl, scopes, flowId.
   *
   * Returns:
   *  - The cached OAuthTokenPayload directly if a valid token already exists.
   *  - { pending: true } if the browser was opened and we are waiting for callback.
   */
  async authorize(
    extensionId: string,
    providerId: string,
    clientId: string,
    authorizationUrl: string,
    tokenUrl: string,
    scopes: string[],
    flowId: string,
  ): Promise<{ pending: true } | OAuthTokenPayload> {
    // 1. Check for a cached valid token — Rust filters expired tokens, so null = start fresh
    const cached = await commands.oauthGetStoredToken(extensionId, providerId);
    if (cached) {
      return cached;
    }

    // 2. Start PKCE flow in Rust (generates verifier/challenge + state, builds URL)
    const { state, authUrl } = await commands.oauthStartFlow(
      extensionId, providerId, clientId, authorizationUrl, tokenUrl, scopes, flowId,
    );

    // 3. Track state → {extensionId, flowId} for error routing in _handleCallback
    this._pendingFlows.set(state, { extensionId, flowId });

    // 4. Open the browser
    await openUrl(authUrl);

    return { pending: true };
  }

  /** Revoke the stored token for an extension+provider. */
  async revokeToken(extensionId: string, providerId: string): Promise<void> {
    await commands.oauthRevokeExtensionToken(extensionId, providerId);
  }

  /** Handle the asyar://oauth/callback deep link. Called by the init() listener. */
  async _handleCallback(url: string): Promise<void> {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    const state = parsed.searchParams.get('state');
    const error = parsed.searchParams.get('error');

    if (!state) return;

    if (error || !code) {
      const pending = this._pendingFlows.get(state);
      if (pending) {
        this._pendingFlows.delete(state);
        this._postToIframe(pending.extensionId, pending.flowId, {
          error: { code: error ?? 'access_denied', message: 'OAuth authorization was denied' },
        });
      }
      return;
    }

    try {
      const result = await commands.oauthExchangeCode(state, code);
      // Clean up local tracking now that exchange succeeded
      this._pendingFlows.delete(state);
      this._postToIframe(result.extensionId, result.flowId, { token: result.token });
    } catch (err) {
      logService.error(`OAuth token exchange failed: ${err}`);
      const pending = this._pendingFlows.get(state);
      if (pending) {
        this._pendingFlows.delete(state);
        this._postToIframe(pending.extensionId, pending.flowId, {
          error: { code: 'exchange_failed', message: String(err) },
        });
      }
    }
  }

  private _postToIframe(extensionId: string, flowId: string, payload: object): void {
    const iframe = document.querySelector<HTMLIFrameElement>(
      `iframe[data-extension-id="${extensionId}"]`,
    );
    iframe?.contentWindow?.postMessage(
      { type: 'asyar:oauth:result', flowId, ...payload },
      getExtensionFrameOrigin(extensionId),
    );
  }
}

export const extensionOAuthService = new ExtensionOAuthService();
