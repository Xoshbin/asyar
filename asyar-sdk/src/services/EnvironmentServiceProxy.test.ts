import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EnvironmentServiceProxy } from './EnvironmentServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';
import type { EnvironmentSnapshot } from '../types/EnvironmentType';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn();
  Object.assign(messageBroker, {
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  });
  const proxy = new EnvironmentServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('EnvironmentServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getEnvironment invokes "environment:getEnvironment"', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const mockSnapshot: EnvironmentSnapshot = {
      locale: 'de-DE',
      language: 'de',
      region: 'DE',
      script: null,
      numberFormat: 'comma',
      platform: 'macos',
      theme: 'dark',
      isDevelopment: false,
      extensionId: 'ext.test',
    };
    mockInvoke.mockResolvedValue(mockSnapshot);

    const result = await proxy.getEnvironment();

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'environment:getEnvironment');
    expect(call).toBeDefined();
    expect(result).toEqual(mockSnapshot);
  });
});
