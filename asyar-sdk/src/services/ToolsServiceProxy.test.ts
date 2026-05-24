import { describe, it, expect, vi, beforeEach } from 'vitest';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), off: vi.fn() },
}));

function makeInvoke() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  });
  return mockInvoke;
}

const sampleTool = {
  id: 't1',
  name: 'Test Tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: { x: { type: 'number' } } },
};

describe('ToolsServiceProxy — module exists in contracts surface', () => {
  it('contracts.ts exports ToolsServiceProxy', async () => {
    const mod = await import('../contracts');
    expect(typeof (mod as any).ToolsServiceProxy).toBe('function');
  });
});

describe('ToolsServiceProxy.registerTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards to tools:registerTool with the tool descriptor', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    const mockInvoke = makeInvoke();
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    const handler = vi.fn().mockResolvedValue({ ok: true });
    await proxy.registerTool(sampleTool, handler).catch(() => {});
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'tools:registerTool');
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      tool: expect.objectContaining({ id: 't1', name: 'Test Tool' }),
    });
  });

  it('stores handler locally so it can be invoked without a broker round-trip', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    makeInvoke();
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    const handler = vi.fn().mockResolvedValue({ result: 42 });
    await proxy.registerTool(sampleTool, handler).catch(() => {});
    const result = await proxy.invokeHandler('t1', { x: 7 });
    expect(handler).toHaveBeenCalledWith({ x: 7 });
    expect(result).toEqual({ result: 42 });
  });

  it('resolves when broker resolves', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    makeInvoke();
    const proxy = new ToolsServiceProxy();
    await expect(proxy.registerTool(sampleTool, async () => null)).resolves.toBeUndefined();
  });
});

describe('ToolsServiceProxy.unregisterTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards to tools:unregisterTool with the tool id', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    const mockInvoke = makeInvoke();
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    await proxy.unregisterTool('t1').catch(() => {});
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'tools:unregisterTool');
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ id: 't1' });
  });

  it('removes the local handler after unregistering', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    makeInvoke();
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    const handler = vi.fn().mockResolvedValue('value');
    await proxy.registerTool(sampleTool, handler).catch(() => {});
    await proxy.unregisterTool('t1').catch(() => {});
    await expect(proxy.invokeHandler('t1', {})).rejects.toThrow();
  });
});

describe('ToolsServiceProxy.listTools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards to tools:listTools and returns the result', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    const mockInvoke = makeInvoke();
    mockInvoke.mockResolvedValueOnce([
      {
        id: 'builtin-tool',
        name: 'Builtin',
        description: 'A built-in tool',
        parameters: {},
        source: 'builtin',
        fullyQualifiedId: 'builtin:builtin-tool',
      },
    ]);
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    const result = await proxy.listTools();
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'tools:listTools');
    expect(call).toBeDefined();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('builtin-tool');
  });
});

describe('ToolsServiceProxy.invokeHandler dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the registered handler with the given args', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    makeInvoke();
    const proxy = new ToolsServiceProxy();
    proxy.setExtensionId('com.example.ext');
    const handler = vi.fn().mockResolvedValue({ answer: 99 });
    await proxy.registerTool(sampleTool, handler).catch(() => {});
    const result = await proxy.invokeHandler('t1', { x: 2 });
    expect(handler).toHaveBeenCalledWith({ x: 2 });
    expect(result).toEqual({ answer: 99 });
  });

  it('throws when invoked with an unregistered tool id', async () => {
    const mod = await import('../contracts');
    const ToolsServiceProxy = (mod as any).ToolsServiceProxy;
    makeInvoke();
    const proxy = new ToolsServiceProxy();
    await expect(proxy.invokeHandler('nonexistent', {})).rejects.toThrow();
  });
});
