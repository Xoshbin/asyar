import { describe, it, expect, vi, afterEach } from 'vitest';
import { MessageBroker } from './MessageBroker';

function freshBroker(): MessageBroker {
  return new MessageBroker();
}

describe('MessageBroker.invoke — host dispatcher fast path', () => {
  const originalParentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');

  afterEach(() => {
    if (originalParentDescriptor) Object.defineProperty(window, 'parent', originalParentDescriptor);
  });

  it('runs the dispatcher synchronously when in host realm', async () => {
    const broker = freshBroker();
    let ran = false;
    broker.setHostDispatcher(() => {
      ran = true;
      return 'ok';
    });

    const promise = broker.invoke('extensions:navigateToView', { viewPath: 'calc/Default' });

    expect(ran).toBe(true);
    await expect(promise).resolves.toBe('ok');
  });

  it('forwards command, payload and extensionId to the dispatcher', async () => {
    const broker = freshBroker();
    const dispatcher = vi.fn(() => undefined);
    broker.setHostDispatcher(dispatcher);

    await broker.invoke('storage:get', { key: 'x' }, 'com.test.ext');

    expect(dispatcher).toHaveBeenCalledWith('storage:get', { key: 'x' }, 'com.test.ext');
  });

  it('awaits async dispatcher results', async () => {
    const broker = freshBroker();
    broker.setHostDispatcher(() => Promise.resolve({ ok: true }));

    await expect(broker.invoke('extensions:searchAll', { query: 'q' })).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects when the dispatcher throws', async () => {
    const broker = freshBroker();
    broker.setHostDispatcher(() => {
      throw new Error('boom');
    });

    await expect(broker.invoke('extensions:navigateToView', { viewPath: 'x/V' })).rejects.toThrow(
      'boom',
    );
  });

  it('rejects when the dispatcher returns a rejected promise', async () => {
    const broker = freshBroker();
    broker.setHostDispatcher(() => Promise.reject(new Error('boom')));

    await expect(broker.invoke('extensions:navigateToView', { viewPath: 'x/V' })).rejects.toThrow(
      'boom',
    );
  });

  it('falls back to postMessage from an iframe context', () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });

    const broker = freshBroker();
    broker.setHostDispatcher(vi.fn());

    void broker.invoke('extensions:navigateToView', { viewPath: 'x/V' });

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message] = fakeParent.postMessage.mock.calls[0];
    expect(message.type).toBe('asyar:api:extensions:navigateToView');
    expect(message.payload).toEqual({ viewPath: 'x/V' });
  });

  it('setHostDispatcher(null) disables the fast path', () => {
    const broker = freshBroker();
    const dispatcher = vi.fn();
    broker.setHostDispatcher(dispatcher);
    broker.setHostDispatcher(null);

    void broker.invoke('extensions:navigateToView', { viewPath: 'x/V' });

    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe('MessageBroker.handleMessage — structured error rejection', () => {
  it('rejects with PermissionDeniedError when errorCode is PERMISSION_DENIED', async () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });

    const broker = freshBroker();
    const promise = broker.invoke('clipboard:readText');

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message] = fakeParent.postMessage.mock.calls[0];

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:response',
          messageId: message.messageId,
          error:
            'Permission denied: "clipboard:read" is required but not declared in manifest.json',
          errorCode: 'PERMISSION_DENIED',
          errorDetails: { permission: 'clipboard:read' },
        },
      }),
    );

    await expect(promise).rejects.toSatisfy((err: any) => {
      expect(err.name).toBe('PermissionDeniedError');
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.permission).toBe('clipboard:read');
      expect(err.message).toContain('Permission denied');
      return true;
    });
  });

  it('rejects with PermissionConsentRequiredError when errorCode is PERMISSION_CONSENT_REQUIRED', async () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });

    const broker = freshBroker();
    const promise = broker.invoke('fs:watch');

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message] = fakeParent.postMessage.mock.calls[0];

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:response',
          messageId: message.messageId,
          error: 'Permission consent required: "fs:watch" requires user review in Settings',
          errorCode: 'PERMISSION_CONSENT_REQUIRED',
          errorDetails: { permission: 'fs:watch' },
        },
      }),
    );

    await expect(promise).rejects.toSatisfy((err: any) => {
      expect(err.name).toBe('PermissionConsentRequiredError');
      expect(err.code).toBe('PERMISSION_CONSENT_REQUIRED');
      expect(err.permission).toBe('fs:watch');
      expect(err.message).toContain('Permission consent required');
      return true;
    });
  });

  it('rejects with AsyarError for other errors with errorCode', async () => {
    const fakeParent = { postMessage: vi.fn() };
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });

    const broker = freshBroker();
    const promise = broker.invoke('storage:get');

    expect(fakeParent.postMessage).toHaveBeenCalledOnce();
    const [message] = fakeParent.postMessage.mock.calls[0];

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:response',
          messageId: message.messageId,
          error: 'Key not found',
          errorCode: 'NOT_FOUND',
          errorDetails: { key: 'foo' },
        },
      }),
    );

    await expect(promise).rejects.toSatisfy((err: any) => {
      expect(err.name).toBe('AsyarError');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.details).toEqual({ key: 'foo' });
      expect(err.message).toBe('Key not found');
      return true;
    });
  });

  it('rejects with IpcTimeoutError on invoke timeout', async () => {
    vi.useFakeTimers();
    try {
      const fakeParent = { postMessage: vi.fn() };
      Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });

      const broker = freshBroker();
      const promise = broker.invoke('storage:get', undefined, undefined, 100);

      // Attach reject handler to avoid unhandled rejection during timer advance
      const rejection = expect(promise).rejects.toSatisfy((err: any) => {
        expect(err.name).toBe('IpcTimeoutError');
        expect(err.code).toBe('IPC_TIMEOUT');
        expect(err.command).toBe('storage:get');
        expect(err.timeoutMs).toBe(100);
        return true;
      });

      vi.advanceTimersByTime(150);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
