import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionServiceProxy } from './ActionServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';
import { ActionContext } from '../types';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({ invoke: vi.fn(), on: vi.fn(), off: vi.fn() })),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  } as any);
  const proxy = new ActionServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('ActionServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registerAction → "actions:registerAction"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.registerAction({ id: 'a1', title: 'A', extensionId: 'ext.test' } as any);
    const call = mockInvoke.mock.calls.find(c => c[0] === 'actions:registerAction');
    expect(call).toBeDefined();
  });

  it('unregisterAction → "actions:unregisterAction"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.unregisterAction('a1');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'actions:unregisterAction');
    expect(call).toBeDefined();
  });

  it('executeAction → "actions:executeAction"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(undefined);
    await proxy.executeAction('a1');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'actions:executeAction');
    expect(call).toBeDefined();
  });

  it('setContext → "actions:setContext"', () => {
    const { proxy, mockInvoke } = makeProxy();
    proxy.setContext(ActionContext.GLOBAL, { commandId: 'cmd1' });
    const call = mockInvoke.mock.calls.find(c => c[0] === 'actions:setContext');
    expect(call).toBeDefined();
  });
});
