import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsServiceProxy } from './SettingsServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  Object.assign(messageBroker, {
    invoke: mockInvoke, on: vi.fn(), off: vi.fn(),
  });
  const proxy = new SettingsServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('SettingsServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('get → "settings:get"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('anthropic');
    const result = await proxy.get<string>('ai', 'provider');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'settings:get');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ section: 'ai', key: 'provider' });
    expect(result).toBe('anthropic');
  });

  it('set → "settings:set"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.set('ai', 'provider', 'openai');
    const call = mockInvoke.mock.calls.find(c => c[0] === 'settings:set');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ section: 'ai', key: 'provider', value: 'openai' });
  });
});
