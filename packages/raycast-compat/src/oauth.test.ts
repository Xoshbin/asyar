import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth } from './oauth';
import { setRaycastContext } from './context';
import type { IOAuthService, IStorageService } from 'asyar-sdk/contracts';

describe('OAuth PKCEClient compat API', () => {
  let mockOAuthService: Partial<IOAuthService>;
  let mockStorageService: Partial<IStorageService>;
  let memoryStore: Record<string, string>;

  beforeEach(() => {
    memoryStore = {};
    mockStorageService = {
      get: vi.fn().mockImplementation(async (k: string) => memoryStore[k] ?? null),
      set: vi.fn().mockImplementation(async (k: string, v: string) => {
        memoryStore[k] = v;
      }),
      delete: vi.fn().mockImplementation(async (k: string) => {
        delete memoryStore[k];
        return true;
      }),
    };

    mockOAuthService = {
      authorize: vi.fn().mockResolvedValue({
        accessToken: 'access_abc_123',
        refreshToken: 'refresh_xyz_456',
        expiresIn: 3600,
        tokenType: 'Bearer',
        scope: 'read write',
      }),
      revokeToken: vi.fn().mockResolvedValue(undefined),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'oauth') return mockOAuthService;
        if (ns === 'storage') return mockStorageService;
        throw new Error(`Unknown service ${ns}`);
      }),
    } as any);
  });

  it('generates PKCE authorization request parameters', async () => {
    const client = new OAuth.PKCEClient({
      redirectMethod: OAuth.RedirectMethod.AppURI,
      providerName: 'GitHub',
    });

    const req = await client.createAuthorizationRequest({
      endpoint: 'https://github.com/login/oauth/authorize',
      clientId: 'client_123',
      scope: 'repo user',
    });

    expect(req.authorizationUrl).toContain('https://github.com/login/oauth/authorize');
    expect(req.authorizationUrl).toContain('client_id=client_123');
    expect(req.codeVerifier).toBeDefined();
    expect(req.codeChallenge).toBeDefined();
  });

  it('persists and retrieves tokens via LocalStorage integration', async () => {
    const client = new OAuth.PKCEClient({
      redirectMethod: OAuth.RedirectMethod.AppURI,
      providerName: 'GitHub',
    });

    const tokens: OAuth.TokenResponse = {
      accessToken: 'token_123',
      refreshToken: 'refresh_123',
    };

    await client.setTokens(tokens);
    const retrieved = await client.getTokens();

    expect(retrieved).toEqual(tokens);

    await client.removeTokens();
    expect(await client.getTokens()).toBeUndefined();
  });
});
