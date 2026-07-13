import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackServiceProxy } from './FeedbackServiceProxy';
import { messageBroker } from '../ipc/MessageBroker';

vi.mock('../ipc/MessageBroker', () => ({
  messageBroker: {
    invoke: vi.fn(),
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
  const proxy = new FeedbackServiceProxy();
  proxy.setExtensionId('ext.test');
  return { proxy, mockInvoke };
}

describe('FeedbackServiceProxy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('report → "feedback:report" with feedback', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const feedback = {
      kind: 'network_failure',
      severity: 'error' as const,
      retryable: false,
      developerDetail: 'Connection refused',
    };
    await proxy.report(feedback);
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'feedback:report');
    expect(call).toBeDefined();
    expect(call![1]).toEqual({ feedback });
  });

  it('showProgress returns a handle that captures this proxy broker', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValueOnce('feedback-1');

    const handle = await proxy.showProgress({ title: 'Downloading' });
    await handle.update({ title: 'Installing', completed: 1, total: 2 });
    await handle.succeed('Installed');

    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      'feedback:showProgress',
      {
        options: { title: 'Downloading' },
      },
      'ext.test',
      undefined,
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      'feedback:updateProgress',
      {
        feedbackId: 'feedback-1',
        update: { title: 'Installing', completed: 1, total: 2 },
      },
      'ext.test',
      undefined,
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(
      3,
      'feedback:finishProgress',
      {
        feedbackId: 'feedback-1',
        outcome: { severity: 'success', title: 'Installed' },
      },
      'ext.test',
      undefined,
    );
  });

  it('announce uses the intentionally constrained announcement method', async () => {
    const { proxy, mockInvoke } = makeProxy();
    const announcement = { id: 'v4.3', title: "What's new", message: 'New commands' };
    await proxy.announce(announcement);
    expect(mockInvoke).toHaveBeenCalledWith(
      'feedback:announce',
      { announcement },
      'ext.test',
      undefined,
    );
  });

  it('routes background delivery through the feedback namespace', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValueOnce('background-1');

    await expect(proxy.sendBackground({ title: 'Finished', body: 'Done' })).resolves.toBe(
      'background-1',
    );
    await proxy.dismissBackground('background-1');

    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      'feedback:sendBackground',
      { options: { title: 'Finished', body: 'Done' } },
      'ext.test',
      undefined,
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(
      2,
      'feedback:dismissBackground',
      { feedbackId: 'background-1' },
      'ext.test',
      undefined,
    );
  });

  it('showHUD → "feedback:showHUD" with title', async () => {
    const { proxy, mockInvoke } = makeProxy();
    await proxy.showHUD('Copied!');
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'feedback:showHUD');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ title: 'Copied!' });
  });

  it('confirmAlert → "feedback:confirmAlert" with options', async () => {
    const { proxy, mockInvoke } = makeProxy();
    mockInvoke.mockResolvedValue(true);
    const opts = { title: 'Are you sure?', message: 'This is permanent' };
    const result = await proxy.confirmAlert(opts);
    const call = mockInvoke.mock.calls.find((c: unknown[]) => c[0] === 'feedback:confirmAlert');
    expect(call).toBeDefined();
    expect(call![1]).toMatchObject({ options: opts });
    expect(result).toBe(true);
  });
});
