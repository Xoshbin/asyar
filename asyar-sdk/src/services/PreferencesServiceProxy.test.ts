import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PreferencesServiceProxy } from './PreferencesServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
      invoke: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new PreferencesServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('PreferencesServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getAll → "preferences:getAll"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.getAll();
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:getAll');
    expect(call).toBeDefined();
  });

  it('set → "preferences:set" with payload', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.set('extension', 'theme', 'dark');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:set');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension', key: 'theme', value: 'dark' });
  });

  it('reset → "preferences:reset" with scope', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.reset('extension');
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'preferences:reset');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ scope: 'extension' });
  });
});
