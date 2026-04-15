import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthServiceProxy } from './OAuthServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';
import type { OAuthConfig, OAuthToken } from './IOAuthService';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeProxy() {
  const mockInvoke = vi.fn();
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  } as any);
  const proxy = new OAuthServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

function validConfig(): OAuthConfig {
  return {
    providerId: 'github',
    clientId: 'my-client-id',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo'],
  };
}

function validToken(): OAuthToken {
  return {
    accessToken: 'gho_abc123',
    tokenType: 'Bearer',
    scopes: ['repo'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function fireOAuthResult(flowId: string, payload: object) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'asyar:oauth:result', flowId, ...payload },
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OAuthServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('authorize()', () => {
    it('resolves immediately when IPC response contains a cached token', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const token = validToken();

      // Host returned cached token directly in IPC response
      mockInvoke.mockResolvedValue(token);

      const result = await proxy.authorize(validConfig());

      expect(result).toEqual(token);
      // setExtensionId patches invoke → originalInvoke(cmd, payload, extensionId, timeoutMs)
      const [cmd, payload] = mockInvoke.mock.calls[0];
      expect(cmd).toBe('oauth:authorize');
      expect(payload).toMatchObject({
        providerId: 'github',
        clientId: 'my-client-id',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo'],
      });
    });

    it('payload key order matches host service parameter order', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue(validToken());

      await proxy.authorize(validConfig());

      const payload = mockInvoke.mock.calls[0][1];
      const keys = Object.keys(payload);
      // Must match: providerId, clientId, authorizationUrl, tokenUrl, scopes, flowId
      expect(keys).toEqual(['providerId', 'clientId', 'authorizationUrl', 'tokenUrl', 'scopes', 'flowId']);
    });

    it('resolves via asyar:oauth:result postMessage when host returns pending:true', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const token = validToken();

      let capturedFlowId: string | undefined;
      mockInvoke.mockImplementation((_cmd: string, payload: { flowId: string }) => {
        capturedFlowId = payload.flowId;
        return Promise.resolve({ pending: true });
      });

      const promise = proxy.authorize(validConfig());

      // Wait for invoke to fire and capture flowId
      await vi.waitFor(() => capturedFlowId !== undefined);

      // Simulate host posting the result
      fireOAuthResult(capturedFlowId!, { token });

      const result = await promise;
      expect(result).toEqual(token);
    });

    it('rejects when asyar:oauth:result carries an error', async () => {
      const { proxy, mockInvoke } = makeProxy();

      let capturedFlowId: string | undefined;
      mockInvoke.mockImplementation((_cmd: string, payload: { flowId: string }) => {
        capturedFlowId = payload.flowId;
        return Promise.resolve({ pending: true });
      });

      const promise = proxy.authorize(validConfig());

      await vi.waitFor(() => capturedFlowId !== undefined);

      fireOAuthResult(capturedFlowId!, {
        error: { code: 'access_denied', message: 'User denied access' },
      });

      await expect(promise).rejects.toThrow('access_denied');
    });

    it('rejects when invoke itself fails', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockRejectedValue(new Error('Permission denied: oauth:use'));

      await expect(proxy.authorize(validConfig())).rejects.toThrow('Permission denied');
    });

    it('ignores asyar:oauth:result messages with a different flowId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const token = validToken();

      let capturedFlowId: string | undefined;
      mockInvoke.mockImplementation((_cmd: string, payload: { flowId: string }) => {
        capturedFlowId = payload.flowId;
        return Promise.resolve({ pending: true });
      });

      const promise = proxy.authorize(validConfig());
      await vi.waitFor(() => capturedFlowId !== undefined);

      // Fire a message with a wrong flowId — should be ignored
      fireOAuthResult('wrong-flow-id', { token });

      // Fire the correct one
      fireOAuthResult(capturedFlowId!, { token });

      const result = await promise;
      expect(result).toEqual(token);
    });

    it('cleans up listener after cached token resolve', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const token = validToken();

      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      mockInvoke.mockResolvedValue(token);

      await proxy.authorize(validConfig());

      expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));
      expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  describe('revokeToken()', () => {
    it('invokes revokeToken with correct providerId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue(undefined);

      await proxy.revokeToken('github');

      const [cmd, payload] = mockInvoke.mock.calls[0];
      expect(cmd).toBe('oauth:revokeToken');
      expect(payload).toEqual({ providerId: 'github' });
    });
  });
});
