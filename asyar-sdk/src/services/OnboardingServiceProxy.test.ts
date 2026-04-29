import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnboardingServiceProxy } from './OnboardingServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

describe('OnboardingServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeProxy() {
    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    Object.assign(messageBroker, {
      invoke: mockInvoke,
      on: vi.fn(),
      off: vi.fn(),
    });
    const proxy = new OnboardingServiceProxy();
    proxy.setExtensionId('ext-1');
    return { proxy, mockInvoke };
  }

  it('complete() invokes "onboarding:complete" with an empty payload', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.complete();
    // setExtensionId patches broker.invoke to inject the extensionId as the
    // third argument; check the command and payload (first two args) only.
    expect(mockInvoke.mock.calls[0][0]).toBe('onboarding:complete');
    expect(mockInvoke.mock.calls[0][1]).toEqual({});
  });

  it('complete() bubbles rejections from the broker', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockRejectedValue(new Error('not onboarded'));
    await expect(proxy.complete()).rejects.toThrow('not onboarded');
  });
});
