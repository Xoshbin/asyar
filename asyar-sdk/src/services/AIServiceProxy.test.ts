import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIServiceProxy } from './AIServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';
import { AIErrorCode } from './IAIService';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

describe('AIServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function fireStreamMessage(data: object) {
    window.dispatchEvent(new MessageEvent('message', { data }));
  }

  function makeProxy() {
    const mockInvoke = vi.fn().mockResolvedValue({ streaming: true });
    vi.mocked(MessageBroker.getInstance).mockReturnValue({
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    } as any);
    const proxy = new AIServiceProxy();
    proxy.setExtensionId('ext-1');
    return { proxy, mockInvoke };
  }

  it('should start stream and receive tokens', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    const onToken = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();

    proxy.stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      { onToken, onDone, onError }
    );

    await vi.waitFor(() => capturedId !== undefined);

    fireStreamMessage({
      type: 'asyar:stream',
      streamId: capturedId,
      phase: 'chunk',
      data: { token: 'hello ' },
    });
    fireStreamMessage({
      type: 'asyar:stream',
      streamId: capturedId,
      phase: 'chunk',
      data: { token: 'world' },
    });

    expect(onToken).toHaveBeenCalledWith('hello ');
    expect(onToken).toHaveBeenCalledWith('world');
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('should handle done phase', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    const onDone = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone, onError: vi.fn() }
    );

    await vi.waitFor(() => capturedId !== undefined);

    fireStreamMessage({
      type: 'asyar:stream',
      streamId: capturedId,
      phase: 'done',
    });

    expect(onDone).toHaveBeenCalled();
  });

  it('should handle error phase from stream', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    const onError = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError }
    );

    await vi.waitFor(() => capturedId !== undefined);

    fireStreamMessage({
      type: 'asyar:stream',
      streamId: capturedId,
      phase: 'error',
      data: { error: { code: 'provider_error', message: 'Rate limited' } },
    });

    expect(onError).toHaveBeenCalledWith({
      code: 'provider_error',
      message: 'Rate limited',
    });
  });

  it('should parse and validate error codes from invoke rejection', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('ai_not_configured: No provider set'));

    const onError = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError }
    );

    await vi.waitFor(() => onError.mock.calls.length > 0);

    expect(onError).toHaveBeenCalledWith({
      code: 'ai_not_configured',
      message: 'No provider set',
    });
  });

  it('should fallback to internal_error for unknown codes in invoke rejection', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('unknown_thing: Something happened'));

    const onError = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError }
    );

    await vi.waitFor(() => onError.mock.calls.length > 0);

    expect(onError).toHaveBeenCalledWith({
      code: 'internal_error',
      message: 'Something happened',
    });
  });

  it('should fallback to internal_error for malformed errors', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('just a message without code'));

    const onError = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError }
    );

    await vi.waitFor(() => onError.mock.calls.length > 0);

    expect(onError).toHaveBeenCalledWith({
      code: 'internal_error',
      message: 'just a message without code',
    });
  });

  it('should clean up listener and stop processing after settle', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    const onToken = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken, onDone: vi.fn(), onError: vi.fn() }
    );

    await vi.waitFor(() => capturedId !== undefined);

    fireStreamMessage({ type: 'asyar:stream', streamId: capturedId, phase: 'done' });
    fireStreamMessage({ type: 'asyar:stream', streamId: capturedId, phase: 'chunk', data: { token: 'after' } });

    expect(onToken).not.toHaveBeenCalled();
  });

  it('should support aborting', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    // Mock window.parent.postMessage
    const spy = vi.spyOn(window.parent, 'postMessage');

    const handle = proxy.stream(
      { messages: [] },
      { onToken: vi.fn(), onDone: vi.fn(), onError: vi.fn() }
    );

    await vi.waitFor(() => capturedId !== undefined);

    handle.abort();

    expect(spy).toHaveBeenCalledWith(
      {
        type: 'asyar:stream:abort',
        streamId: capturedId,
      },
      '*'
    );
  });

  it('should ignore messages with wrong streamId', async () => {
    const { proxy, mockInvoke } = makeProxy();
    let capturedId: string | undefined;
    mockInvoke.mockImplementation((_cmd: string, payload: { streamId: string }) => {
      capturedId = payload.streamId;
      return Promise.resolve({ streaming: true });
    });

    const onToken = vi.fn();
    proxy.stream(
      { messages: [] },
      { onToken, onDone: vi.fn(), onError: vi.fn() }
    );

    await vi.waitFor(() => capturedId !== undefined);

    fireStreamMessage({
      type: 'asyar:stream',
      streamId: 'wrong-id',
      phase: 'chunk',
      data: { token: 'ignored' },
    });

    expect(onToken).not.toHaveBeenCalled();
  });
});
