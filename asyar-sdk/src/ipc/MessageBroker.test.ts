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
    broker.setHostDispatcher(() => { ran = true; return 'ok'; });

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

    await expect(broker.invoke('extensions:searchAll', { query: 'q' })).resolves.toEqual({ ok: true });
  });

  it('rejects when the dispatcher throws', async () => {
    const broker = freshBroker();
    broker.setHostDispatcher(() => { throw new Error('boom'); });

    await expect(broker.invoke('extensions:navigateToView', { viewPath: 'x/V' })).rejects.toThrow('boom');
  });

  it('rejects when the dispatcher returns a rejected promise', async () => {
    const broker = freshBroker();
    broker.setHostDispatcher(() => Promise.reject(new Error('boom')));

    await expect(broker.invoke('extensions:navigateToView', { viewPath: 'x/V' })).rejects.toThrow('boom');
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
