import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackServiceProxy } from './FeedbackServiceProxy';
import { MessageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  MessageBroker: {
    getInstance: vi.fn(() => ({
      invoke: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    })),
  },
}));

function makeProxy() {
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  vi.mocked(MessageBroker.getInstance).mockReturnValue({
    invoke: mockInvoke,
    on: vi.fn(),
    off: vi.fn(),
  } as any);
  const proxy = new FeedbackServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('FeedbackServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('showToast → "feedback:showToast" with options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue('toast-id-1');
    const opts = { title: 'Done', style: 'success' as const };
    const result = await proxy.showToast(opts);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'feedback:showToast',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ options: opts });
    expect(result).toBe('toast-id-1');
  });

  it('updateToast → "feedback:updateToast" with toastId and options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const opts = { title: 'Updated' };
    await proxy.updateToast('toast-1', opts);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'feedback:updateToast',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ toastId: 'toast-1', options: opts });
  });

  it('hideToast → "feedback:hideToast" with toastId', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.hideToast('toast-1');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'feedback:hideToast',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ toastId: 'toast-1' });
  });

  it('showHUD → "feedback:showHUD" with title', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.showHUD('Copied!');
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'feedback:showHUD',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ title: 'Copied!' });
  });

  it('confirmAlert → "feedback:confirmAlert" with options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const opts = { title: 'Are you sure?', message: 'This is permanent' };
    const result = await proxy.confirmAlert(opts);
    const call = mockInvoke.mock.calls.find(
      (c: unknown[]) => c[0] === 'feedback:confirmAlert',
    );
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ options: opts });
    expect(result).toBe(true);
  });
});
