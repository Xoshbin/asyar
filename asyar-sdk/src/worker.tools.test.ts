/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function setRole(role: string | undefined) {
  if (role === undefined) {
    delete (window as any).__ASYAR_ROLE__;
  } else {
    (window as any).__ASYAR_ROLE__ = role;
  }
}

describe('worker proxy bag — tools service', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
  });

  it('ExtensionContext.proxies exposes a tools entry', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect((ctx.proxies as any).tools).toBeDefined();
  });

  it('tools entry has registerTool method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof (ctx.proxies as any).tools.registerTool).toBe('function');
  });

  it('tools entry has unregisterTool method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof (ctx.proxies as any).tools.unregisterTool).toBe('function');
  });

  it('tools entry has listTools method', async () => {
    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    expect(typeof (ctx.proxies as any).tools.listTools).toBe('function');
  });
});

// ── Item 7: worker dispatches asyar:tools:invoke to ToolsServiceProxy ─────────

describe('worker — asyar:tools:invoke dispatch', () => {
  beforeEach(() => {
    vi.resetModules();
    setRole('worker');
  });

  afterEach(() => {
    setRole(undefined);
    vi.restoreAllMocks();
  });

  it('dispatches asyar:tools:invoke to ToolsServiceProxy.invokeHandler and posts response', async () => {
    // Patch the MessageBroker before importing the worker so registerTool
    // resolves immediately without a real host round-trip.
    const { messageBroker } = await import('./ipc/MessageBroker');
    vi.spyOn(messageBroker, 'invoke').mockResolvedValue(undefined as never);

    const { ExtensionContext } = await import('./worker');
    const ctx = new ExtensionContext();
    ctx.setExtensionId('com.example.test');

    const handler = vi.fn().mockResolvedValue({ result: 'ok' });
    const tool = {
      id: 't1',
      name: 'T1',
      description: 'Test tool',
      parameters: {},
    };
    // Register the handler — broker.invoke is mocked so this resolves fast.
    await (ctx.proxies as any).tools.registerTool(tool, handler);

    const postedMessages: unknown[] = [];
    vi.spyOn(window.parent, 'postMessage').mockImplementation((msg: unknown) => {
      postedMessages.push(msg);
    });

    // Simulate the host posting an asyar:tools:invoke envelope.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'asyar:tools:invoke',
          messageId: 'm1',
          payload: { id: 't1', args: { x: 7 } },
        },
      }),
    );

    // Allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 20));

    // RED: handler not called because the worker has no asyar:tools:invoke listener yet.
    expect(handler).toHaveBeenCalledWith({ x: 7 });

    const response = postedMessages.find(
      (m) =>
        m !== null &&
        typeof m === 'object' &&
        (m as { type?: unknown }).type === 'asyar:tools:invoke:response' &&
        (m as { messageId?: unknown }).messageId === 'm1',
    );
    // RED: no response posted because no listener dispatched to handler.
    expect(response).toBeDefined();
  });
});
