/**
 * Configuration for an OAuth 2.0 PKCE flow.
 * Pass this to `IOAuthService.authorize()`.
 */
export interface OAuthConfig {
  /**
   * Stable identifier for this provider, used as the storage key.
   * E.g. `"github"`, `"notion"`, `"google"`.
   */
  providerId: string;
  /** OAuth 2.0 client ID registered with the provider. */
  clientId: string;
  /** The provider's authorization endpoint URL. */
  authorizationUrl: string;
  /** The provider's token exchange endpoint URL. */
  tokenUrl: string;
  /** Requested OAuth scopes. */
  scopes: string[];
}

/** An OAuth 2.0 token set returned after a successful authorization flow. */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  /**
   * Token expiry as a Unix timestamp in seconds.
   * `undefined` means the token has no expiry.
   */
  expiresAt?: number;
}

/** Error payload posted back to the extension when an OAuth flow fails. */
export interface OAuthError {
  code: 'access_denied' | 'exchange_failed' | 'timeout' | string;
  message: string;
}

/**
 * OAuth 2.0 PKCE flow for extensions.
 *
 * Requires the `oauth:use` permission in the extension manifest.
 *
 * @example
 * ```ts
 * const token = await ctx.proxies.oauth.authorize({
 *   providerId: 'github',
 *   clientId: 'my-client-id',
 *   authorizationUrl: 'https://github.com/login/oauth/authorize',
 *   tokenUrl: 'https://github.com/login/oauth/access_token',
 *   scopes: ['repo', 'read:user'],
 * });
 * ```
 */
export interface IOAuthService {
  /**
   * Authorize with a third-party provider using PKCE.
   *
   * Returns a cached, valid token immediately if one exists (no browser popup).
   * Otherwise opens the system browser for the user to authorize, then resolves
   * with the token once the callback deep-link arrives.
   */
  authorize(config: OAuthConfig): Promise<OAuthToken>;

  /**
   * Remove the stored token for the given provider.
   * The next call to `authorize()` will start a fresh browser flow.
   */
  revokeToken(providerId: string): Promise<void>;
}
