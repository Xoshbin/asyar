/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AiServiceProxy } from './AiServiceProxy';
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

describe('AiServiceProxy.stream inside a Web Worker', () => {
  let proxy: AiServiceProxy;
  let mockInvoke: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke = vi.fn().mockImplementation(() => new Promise(() => {}));
    Object.assign(messageBroker, { invoke: mockInvoke, on: vi.fn(), off: vi.fn() });
    proxy = new AiServiceProxy();
    proxy.setExtensionId('ext.test');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('receives chunks and resolves on done', async () => {
    const { fire } = stubWorkerGlobals();
    const chunks: string[] = [];
    const promise = proxy.stream('hi', (d) => chunks.push(d));
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const streamId = mockInvoke.mock.calls[0][1].streamId;

    fire({ type: 'asyar:stream', streamId, phase: 'chunk', data: { delta: 'Hel' } });
    fire({ type: 'asyar:stream', streamId, phase: 'chunk', data: 'lo' });
    fire({ type: 'asyar:stream', streamId, phase: 'done', data: {} });

    await expect(promise).resolves.toBe('Hello');
    expect(chunks).toEqual(['Hel', 'lo']);
  });

  it('removes its listener when the stream ends', async () => {
    const { fire, listeners } = stubWorkerGlobals();
    const promise = proxy.stream('hi', () => {});
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(listeners.size).toBe(1);
    fire({
      type: 'asyar:stream',
      streamId: mockInvoke.mock.calls[0][1].streamId,
      phase: 'done',
      data: {},
    });
    await promise;
    expect(listeners.size).toBe(0);
  });

  it('abort posts asyar:stream:abort through self.postMessage', async () => {
    const { postMessage } = stubWorkerGlobals();
    const controller = new AbortController();
    const promise = proxy.stream('hi', () => {}, { signal: controller.signal });
    promise.catch(() => {});
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());

    controller.abort();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'asyar:stream:abort',
      streamId: mockInvoke.mock.calls[0][1].streamId,
    });
    await expect(promise).rejects.toBeDefined();
  });
});
