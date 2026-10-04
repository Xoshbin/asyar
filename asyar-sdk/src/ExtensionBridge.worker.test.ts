/** @vitest-environment node */
import { it, expect, vi, afterEach } from 'vitest';
vi.mock('./ipc/MessageBroker', () => ({ messageBroker: { on: vi.fn(), send: vi.fn() } }));
afterEach(() => vi.unstubAllGlobals());
it('handles search and command messages in a real worker-shaped scope without window', async () => {
  const handlers: Function[] = [];
  const postMessage = vi.fn();
  vi.stubGlobal('self', {
    addEventListener: (_type: string, handler: Function) => handlers.push(handler),
    postMessage,
  });
  vi.resetModules();
  const { ExtensionBridge } = await import('./ExtensionBridge');
  const bridge = new ExtensionBridge();
  bridge.registerManifest({ id: 'org.test' } as any);
  const executeCommand = vi.fn();
  bridge.registerExtensionImplementation('org.test', {
    search: async () => [
      { id: 'stable', title: 'Result', score: 1, actionId: 'open', actionPayload: { value: 42 } },
    ],
    executeCommand,
  } as any);
  expect(handlers.length).toBeGreaterThan(0);
  await handlers[handlers.length - 1]({
    data: { type: 'asyar:search:request', messageId: 'query', payload: { query: 'q' } },
  });
  expect(postMessage).toHaveBeenCalledWith({
    type: 'asyar:search:response',
    messageId: 'query',
    result: [
      expect.objectContaining({ id: 'stable', actionId: 'open', actionPayload: { value: 42 } }),
    ],
  });
  await handlers[handlers.length - 1]({
    data: { type: 'asyar:command:execute', payload: { commandId: 'run', args: { x: 1 } } },
  });
  expect(executeCommand).toHaveBeenCalledWith('run', { x: 1 });
});
