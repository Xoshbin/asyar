/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OAuthServiceProxy } from './OAuthServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

/** A Web Worker has no `window` (node environment); its global is `self`. */
function stubWorkerGlobals() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const postMessage = vi.fn();
  vi.stubGlobal('self', {
    postMessage,
    addEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: (event: MessageEvent) => void) => listeners.delete(cb),
  });
  const fire = (data: object) => listeners.forEach((cb) => cb({ data } as MessageEvent));
  return { listeners, postMessage, fire };
}

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue({ pending: true });
  Object.assign(messageBroker, { invoke: mockInvoke, on: vi.fn(), off: vi.fn() });
  const proxy = new OAuthServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

const config = {
  providerId: 'github',
  clientId: 'cid',
  authorizationUrl: 'https://example.com/auth',
  tokenUrl: 'https://example.com/token',
  scopes: ['repo'],
};

describe('OAuthServiceProxy inside a Web Worker', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('resolves when asyar:oauth:result arrives on self', async () => {
    const { fire, listeners } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();

    const promise = proxy.authorize(config);
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const flowId = mockInvoke.mock.calls[0][1].flowId;
    expect(listeners.size).toBe(1);

    const token = { accessToken: 'tok-123', tokenType: 'Bearer', scopes: ['repo'] };
    fire({ type: 'asyar:oauth:result', flowId, token });

    await expect(promise).resolves.toEqual(token);
    expect(listeners.size).toBe(0);
  });

  it('rejects and removes listener when asyar:oauth:result carries an error', async () => {
    const { fire, listeners } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();

    const promise = proxy.authorize(config);
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const flowId = mockInvoke.mock.calls[0][1].flowId;

    fire({
      type: 'asyar:oauth:result',
      flowId,
      error: { code: 'access_denied', message: 'Denied' },
    });

    await expect(promise).rejects.toThrow('OAuth error [access_denied]: Denied');
    expect(listeners.size).toBe(0);
  });

  it('cleans up listener when invoke returns a cached token', async () => {
    const { listeners } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();
    const cached = { accessToken: 'cached', tokenType: 'Bearer', scopes: [] };
    mockInvoke.mockResolvedValueOnce(cached);

    await expect(proxy.authorize(config)).resolves.toEqual(cached);
    expect(listeners.size).toBe(0);
  });
});
