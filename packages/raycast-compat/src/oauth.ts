import { LocalStorage } from './storage';

export namespace OAuth {
  export enum RedirectMethod {
    AppURI = 'app-uri',
    Web = 'web',
  }

  export interface TokenResponse {
    accessToken: string;
    refreshToken?: string;
    idToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scope?: string;
  }

  export interface AuthorizationRequestOptions {
    endpoint: string;
    clientId: string;
    scope: string;
    extraParameters?: Record<string, string>;
  }

  export interface AuthorizationRequest {
    authorizationUrl: string;
    codeVerifier: string;
    codeChallenge: string;
    state: string;
  }

  export interface PKCEClientOptions {
    redirectMethod: RedirectMethod;
    providerName?: string;
    providerId?: string;
    description?: string;
  }

  function generateRandomString(length: number = 43): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const bytes = new Uint8Array(length);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
      for (let i = 0; i < length; i++) {
        result += charset[bytes[i] % charset.length];
      }
    } else {
      for (let i = 0; i < length; i++) {
        result += charset[Math.floor(Math.random() * charset.length)];
      }
    }
    return result;
  }

  async function sha256(plain: string): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoder = new TextEncoder();
      const data = encoder.encode(plain);
      const hash = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hash));
      const base64 = btoa(String.fromCharCode(...hashArray));
      return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    // Fallback pseudo-hash for node/testing if crypto.subtle is unavailable
    return Buffer.from(plain).toString('base64url');
  }

  export class PKCEClient {
    private providerKey: string;
    public readonly redirectMethod: RedirectMethod;
    public readonly providerName?: string;
    public readonly description?: string;

    constructor(options: PKCEClientOptions) {
      this.redirectMethod = options.redirectMethod;
      this.providerName = options.providerName;
      this.description = options.description;
      this.providerKey = options.providerId || options.providerName || 'default_oauth_provider';
    }

    private getStorageKey(): string {
      return `__asyar_oauth_tokens_${this.providerKey}`;
    }

    async createAuthorizationRequest(
      options: AuthorizationRequestOptions,
    ): Promise<AuthorizationRequest> {
      const codeVerifier = generateRandomString(64);
      const codeChallenge = await sha256(codeVerifier);
      const state = generateRandomString(32);

      const redirectUri =
        this.redirectMethod === RedirectMethod.AppURI
          ? `asyar://oauth/${encodeURIComponent(this.providerKey)}`
          : 'https://oauth.asyar.org/callback';

      const url = new URL(options.endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', options.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', options.scope);
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('state', state);

      if (options.extraParameters) {
        for (const [k, v] of Object.entries(options.extraParameters)) {
          url.searchParams.set(k, v);
        }
      }

      return {
        authorizationUrl: url.toString(),
        codeVerifier,
        codeChallenge,
        state,
      };
    }

    async getTokens(): Promise<TokenResponse | undefined> {
      return LocalStorage.getItem<TokenResponse>(this.getStorageKey());
    }

    async setTokens(tokens: TokenResponse): Promise<void> {
      await LocalStorage.setItem(this.getStorageKey(), tokens as any);
    }

    async removeTokens(): Promise<void> {
      await LocalStorage.removeItem(this.getStorageKey());
    }
  }
}
