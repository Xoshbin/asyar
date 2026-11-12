/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ShellServiceProxy } from './ShellServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

/**
 * A Web Worker has no `window`; its global is `self`. These tests remove
 * `window` (node environment) and provide a fake worker `self` (issue #1028).
 */
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
  const mockInvoke = vi.fn().mockResolvedValue({ streaming: true });
  Object.assign(messageBroker, { invoke: mockInvoke, on: vi.fn(), off: vi.fn() });
  const proxy = new ShellServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('ShellServiceProxy inside a Web Worker', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it('spawn does not throw when `window` is missing', () => {
    stubWorkerGlobals();
    const { proxy } = makeProxy();
    expect(() => proxy.spawn({ program: 'echo' })).not.toThrow();
  });

  it('delivers chunk and done events from self', async () => {
    const { fire } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();
    const handle = proxy.spawn({ program: 'echo', args: ['hi'] });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const spawnId = mockInvoke.mock.calls[0][1].spawnId;

    const chunks: unknown[] = [];
    const onDone = vi.fn();
    handle.onChunk((c) => chunks.push(c));
    handle.onDone(onDone);

    fire({
      type: 'asyar:stream',
      streamId: spawnId,
      phase: 'chunk',
      data: { stream: 'stdout', data: 'hi' },
    });
    fire({ type: 'asyar:stream', streamId: spawnId, phase: 'done', data: { exitCode: 0 } });

    expect(chunks).toEqual([{ stream: 'stdout', data: 'hi' }]);
    expect(onDone).toHaveBeenCalledWith(0);
  });

  it('removes its listener after done', async () => {
    const { fire, listeners } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();
    proxy.spawn({ program: 'echo' });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    expect(listeners.size).toBe(1);
    fire({
      type: 'asyar:stream',
      streamId: mockInvoke.mock.calls[0][1].spawnId,
      phase: 'done',
      data: {},
    });
    expect(listeners.size).toBe(0);
  });

  it('abort posts asyar:stream:abort through self.postMessage', async () => {
    const { postMessage } = stubWorkerGlobals();
    const { proxy, mockInvoke } = makeProxy();
    const handle = proxy.spawn({ program: 'sleep', args: ['9'] });
    await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
    const onError = vi.fn();
    handle.onError(onError);

    handle.abort();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'asyar:stream:abort',
      streamId: mockInvoke.mock.calls[0][1].spawnId,
    });
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABORTED' }));
  });
});
