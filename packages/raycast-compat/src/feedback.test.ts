import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Toast, showToast, showHUD } from './feedback';
import { setRaycastContext } from './context';
import type { IFeedbackService, FeedbackProgressHandle } from 'asyar-sdk/contracts';

describe('Toast and Feedback compat API', () => {
  let mockFeedbackService: Partial<IFeedbackService>;
  let mockProgressHandle: FeedbackProgressHandle;

  beforeEach(() => {
    mockProgressHandle = {
      update: vi.fn().mockResolvedValue(undefined),
      succeed: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
      dismiss: vi.fn().mockResolvedValue(undefined),
    };

    mockFeedbackService = {
      report: vi.fn().mockResolvedValue(undefined),
      showProgress: vi.fn().mockResolvedValue(mockProgressHandle),
      showHUD: vi.fn().mockResolvedValue(undefined),
    };

    setRaycastContext({
      getService: vi.fn().mockImplementation((ns: string) => {
        if (ns === 'feedback') return mockFeedbackService;
        throw new Error(`Unknown service ${ns}`);
      }),
    } as any);
  });

  it('shows success toast using object options', async () => {
    const toast = await showToast({
      style: Toast.Style.Success,
      title: 'Action Completed',
      message: 'Everything went well',
    });

    expect(toast).toBeInstanceOf(Toast);
    expect(toast.title).toBe('Action Completed');
    expect(toast.style).toBe(Toast.Style.Success);
    expect(mockFeedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast',
        severity: 'success',
      }),
    );
  });

  it('shows failure toast using positional arguments', async () => {
    const toast = await showToast(Toast.Style.Failure, 'Failed to save', 'Disk full');

    expect(toast.title).toBe('Failed to save');
    expect(toast.style).toBe(Toast.Style.Failure);
    expect(mockFeedbackService.report).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'toast',
        severity: 'error',
      }),
    );
  });

  it('shows animated toast using progress handle and supports updating and hiding', async () => {
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: 'Uploading...',
    });

    expect(mockFeedbackService.showProgress).toHaveBeenCalledWith({
      title: 'Uploading...',
    });

    toast.title = 'Finalizing...';
    toast.style = Toast.Style.Success;
    await toast.show();

    expect(mockProgressHandle.succeed).toHaveBeenCalledWith('Finalizing...');

    await toast.hide();
    expect(mockProgressHandle.dismiss).toHaveBeenCalled();
  });

  it('shows HUD and dismisses launcher window', async () => {
    await showHUD('Copied to clipboard');

    expect(mockFeedbackService.showHUD).toHaveBeenCalledWith('Copied to clipboard');
  });
});
