import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShellServiceProxy } from './ShellServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue({ streaming: true });
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new ShellServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

function fireStreamMessage(data: object) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

describe('ShellServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── IPC type string ────────────────────────────────────────────────────────

  describe('broker.invoke type string', () => {
    it('calls broker.invoke with "shell:spawn" (canonical namespace)', async () => {
      const { proxy, mockInvoke } = makeProxy();
      proxy.spawn({ program: 'echo', args: ['hi'] });
      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
      const [cmd, payload] = mockInvoke.mock.calls[0];
      expect(cmd).toBe('shell:spawn');
      expect(payload).toMatchObject({ program: 'echo', args: ['hi'] });
    });

    it('includes spawnId in the payload', async () => {
      const { proxy, mockInvoke } = makeProxy();
      proxy.spawn({ program: 'git', args: ['status'] });
      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
      const payload = mockInvoke.mock.calls[0][1];
      expect(typeof payload.spawnId).toBe('string');
      expect(payload.spawnId.length).toBeGreaterThan(0);
    });
  });

  // ── Stream callbacks ───────────────────────────────────────────────────────

  describe('stream callbacks', () => {
    it('fires onChunk for each stdout/stderr chunk', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const onChunk = vi.fn();
      const handle = proxy.spawn({ program: 'echo', args: ['hi'] });
      handle.onChunk(onChunk);

      await vi.waitFor(() => capturedId !== undefined);

      fireStreamMessage({ type: 'asyar:stream', streamId: capturedId!, phase: 'chunk', data: { stream: 'stdout', data: 'hi' } });
      fireStreamMessage({ type: 'asyar:stream', streamId: capturedId!, phase: 'chunk', data: { stream: 'stderr', data: 'warn' } });

      expect(onChunk).toHaveBeenCalledTimes(2);
      expect(onChunk).toHaveBeenNthCalledWith(1, { stream: 'stdout', data: 'hi' });
      expect(onChunk).toHaveBeenNthCalledWith(2, { stream: 'stderr', data: 'warn' });
    });

    it('fires onDone with exitCode when done phase arrives', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const onDone = vi.fn();
      const handle = proxy.spawn({ program: 'echo', args: [] });
      handle.onDone(onDone);

      await vi.waitFor(() => capturedId !== undefined);

      fireStreamMessage({ type: 'asyar:stream', streamId: capturedId!, phase: 'done', data: { exitCode: 0 } });

      expect(onDone).toHaveBeenCalledWith(0);
    });

    it('fires onError when stream error phase arrives', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const onError = vi.fn();
      const handle = proxy.spawn({ program: 'notfound' });
      handle.onError(onError);

      await vi.waitFor(() => capturedId !== undefined);

      fireStreamMessage({
        type: 'asyar:stream',
        streamId: capturedId!,
        phase: 'error',
        data: { error: { code: 'NOT_FOUND', message: 'Binary not found' } },
      });

      expect(onError).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: 'Binary not found' });
    });

    it('ignores stream messages with a different streamId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const onChunk = vi.fn();
      const handle = proxy.spawn({ program: 'echo' });
      handle.onChunk(onChunk);

      await vi.waitFor(() => capturedId !== undefined);

      fireStreamMessage({ type: 'asyar:stream', streamId: 'wrong-id', phase: 'chunk', data: { stream: 'stdout', data: 'nope' } });

      expect(onChunk).not.toHaveBeenCalled();
    });
  });

  // ── Invoke rejection → onError ─────────────────────────────────────────────

  describe('invoke rejection', () => {
    it('fires onError when broker.invoke rejects (e.g. service not found)', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockRejectedValue(new Error('Service not found'));

      const onError = vi.fn();
      const onDone = vi.fn();
      const handle = proxy.spawn({ program: 'echo' });
      handle.onError(onError);
      handle.onDone(onDone);

      await vi.waitFor(() => onError.mock.calls.length > 0);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SPAWN_FAILED' }),
      );
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  // ── Abort ──────────────────────────────────────────────────────────────────

  describe('abort', () => {
    it('fires onError with ABORTED code and posts abort message', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const spy = vi.spyOn(window.parent, 'postMessage');
      const onError = vi.fn();
      const handle = proxy.spawn({ program: 'sleep', args: ['10'] });
      handle.onError(onError);

      await vi.waitFor(() => capturedId !== undefined);
      handle.abort();

      expect(onError).toHaveBeenCalledWith({ code: 'ABORTED', message: 'Process was aborted by the extension' });
      expect(spy).toHaveBeenCalledWith({ type: 'asyar:stream:abort', streamId: capturedId! }, '*');
    });

    it('abort after done is a no-op', async () => {
      const { proxy, mockInvoke } = makeProxy();
      let capturedId: string;
      mockInvoke.mockImplementation((_cmd: string, payload: { spawnId: string }) => {
        capturedId = payload.spawnId;
        return Promise.resolve({ streaming: true });
      });

      const onError = vi.fn();
      const handle = proxy.spawn({ program: 'echo' });
      handle.onError(onError);

      await vi.waitFor(() => capturedId !== undefined);
      fireStreamMessage({ type: 'asyar:stream', streamId: capturedId!, phase: 'done', data: { exitCode: 0 } });

      handle.abort(); // should be no-op since already settled

      expect(onError).not.toHaveBeenCalled();
    });
  });

  // ── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('calls broker.invoke with "shell:list" and returns the descriptor array', async () => {
      const { proxy, mockInvoke } = makeProxy();
      const descriptors = [
        { spawnId: 's1', program: '/bin/echo', args: ['a'], pid: 100, startedAt: 1 },
        { spawnId: 's2', program: '/bin/git', args: ['status'], pid: 101, startedAt: 2 },
      ];
      mockInvoke.mockResolvedValue(descriptors);

      const result = await proxy.list();

      // BaseServiceProxy patches invoke to forward the extension id and
      // optional per-call timeout; assert positional prefix only.
      const call = mockInvoke.mock.calls[0];
      expect(call[0]).toBe('shell:list');
      expect(call[1]).toEqual({});
      expect(result).toEqual(descriptors);
    });

    it('returns an empty array when the broker returns undefined', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue(undefined);

      const result = await proxy.list();

      expect(result).toEqual([]);
    });

    it('propagates broker rejections to the caller', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockRejectedValue(new Error('boom'));

      await expect(proxy.list()).rejects.toThrow('boom');
    });
  });

  // ── attach() ───────────────────────────────────────────────────────────────

  describe('attach(spawnId)', () => {
    it('calls broker.invoke with "shell:attach" and the given spawnId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue({ spawnId: 's1', program: 'p', args: [], pid: 1, startedAt: 0 });

      proxy.attach('s1');

      await vi.waitFor(() => expect(mockInvoke).toHaveBeenCalled());
      const call = mockInvoke.mock.calls[0];
      expect(call[0]).toBe('shell:attach');
      expect(call[1]).toEqual({ spawnId: 's1' });
    });

    it('fires onChunk for stream messages matching the attached spawnId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue({});
      const onChunk = vi.fn();

      const handle = proxy.attach('attach-id-1');
      handle.onChunk(onChunk);

      fireStreamMessage({
        type: 'asyar:stream',
        streamId: 'attach-id-1',
        phase: 'chunk',
        data: { stream: 'stdout', data: 'tick' },
      });

      expect(onChunk).toHaveBeenCalledWith({ stream: 'stdout', data: 'tick' });
    });

    it('fires onDone when a done phase arrives (Rust immediate-emit for finished entries)', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue({});
      const onDone = vi.fn();

      const handle = proxy.attach('attach-id-done');
      handle.onDone(onDone);

      fireStreamMessage({
        type: 'asyar:stream',
        streamId: 'attach-id-done',
        phase: 'done',
        data: { exitCode: 0 },
      });

      expect(onDone).toHaveBeenCalledWith(0);
    });

    it('fires onError with ATTACH_FAILED when broker.invoke rejects (unknown id)', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockRejectedValue(new Error('spawnId "nope" is not tracked'));
      const onError = vi.fn();

      const handle = proxy.attach('nope');
      handle.onError(onError);

      await vi.waitFor(() => onError.mock.calls.length > 0);

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ATTACH_FAILED' }),
      );
    });

    it('ignores stream messages for other spawnIds', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue({});
      const onChunk = vi.fn();

      const handle = proxy.attach('mine');
      handle.onChunk(onChunk);

      fireStreamMessage({
        type: 'asyar:stream',
        streamId: 'someone-elses',
        phase: 'chunk',
        data: { stream: 'stdout', data: 'nope' },
      });

      expect(onChunk).not.toHaveBeenCalled();
    });

    it('abort posts an asyar:stream:abort with the attached spawnId', async () => {
      const { proxy, mockInvoke } = makeProxy();
      mockInvoke.mockResolvedValue({});
      const spy = vi.spyOn(window.parent, 'postMessage');
      const onError = vi.fn();

      const handle = proxy.attach('abort-me');
      handle.onError(onError);
      handle.abort();

      expect(spy).toHaveBeenCalledWith(
        { type: 'asyar:stream:abort', streamId: 'abort-me' },
        '*',
      );
      expect(onError).toHaveBeenCalledWith({
        code: 'ABORTED',
        message: 'Process was aborted by the extension',
      });
    });
  });
});
