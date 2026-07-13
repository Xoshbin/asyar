import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../../lib/ipc/commands', () => ({
  showHud: vi.fn(async () => {}),
  hideHud: vi.fn(async () => {}),
  hideWindow: vi.fn(async () => {}),
}));
vi.mock('./internal/feedbackCommands', () => ({
  publish: vi.fn(async () => 'feedback-1'),
  getCurrent: vi.fn(async () => null),
  updateProgress: vi.fn(async () => {}),
  finishProgress: vi.fn(async () => {}),
  dismiss: vi.fn(async () => null),
  acceptAnnouncement: vi.fn(async () => true),
}));
vi.mock('../notification/notificationService', () => ({
  notificationService: {
    send: vi.fn(async () => 'background-1'),
    dismiss: vi.fn(async () => {}),
    checkPermission: vi.fn(async () => true),
    requestPermission: vi.fn(async () => true),
  },
}));

import * as commands from '../../lib/ipc/commands';
import * as feedbackCommands from './internal/feedbackCommands';
import { feedbackService } from './feedbackService.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  feedbackService.reset();
  vi.mocked(feedbackCommands.publish).mockResolvedValue('feedback-1');
  vi.mocked(feedbackCommands.dismiss).mockResolvedValue(null);
  vi.mocked(feedbackCommands.acceptAnnouncement).mockResolvedValue(true);
});

describe('feedback bar lifecycle', () => {
  it('replaces stale local state with Rust authoritative state after dismissal', async () => {
    const current = {
      id: 'feedback-error',
      source: 'extension' as const,
      kind: 'playground_error',
      severity: 'error' as const,
      retryable: false,
      context: { message: 'Stuck error' },
    };
    const promoted = {
      id: 'feedback-progress',
      source: 'extension' as const,
      kind: 'progress',
      severity: 'progress' as const,
      retryable: false,
      context: {},
      progress: { title: 'Downloading' },
    };
    feedbackService.current = current;
    vi.mocked(feedbackCommands.dismiss).mockResolvedValueOnce(promoted);

    await feedbackService.dismiss(current.id);

    expect(feedbackService.current).toEqual(promoted);
  });

  it('publishes normal feedback to the Rust channel', async () => {
    await feedbackService.report({
      source: 'frontend',
      kind: 'network_failure',
      severity: 'error',
      retryable: false,
      developerDetail: 'Connection refused',
    });

    expect(feedbackCommands.publish).toHaveBeenCalledWith({
      source: 'frontend',
      kind: 'network_failure',
      severity: 'error',
      retryable: false,
      context: {},
      developerDetail: 'Connection refused',
      extensionId: undefined,
      retryActionId: undefined,
      reportActionId: undefined,
    });
  });

  it('returns a progress handle backed by the Rust lifecycle', async () => {
    const handle = await feedbackService.showProgress({ title: 'Downloading' });
    await handle.update({ title: 'Installing', completed: 1, total: 2 });
    await handle.succeed('Installed');
    await handle.fail('Install failed', 'Checksum mismatch');
    await handle.dismiss();

    expect(feedbackCommands.updateProgress).toHaveBeenCalledWith('feedback-1', {
      title: 'Installing',
      completed: 1,
      total: 2,
    });
    expect(feedbackCommands.finishProgress).toHaveBeenCalledWith(
      'feedback-1',
      'success',
      'Installed',
    );
    expect(feedbackCommands.finishProgress).toHaveBeenCalledWith(
      'feedback-1',
      'error',
      'Install failed',
      'Checksum mismatch',
    );
    expect(feedbackCommands.dismiss).toHaveBeenCalledWith('feedback-1');
  });

  it('shows only announcements accepted by the host limiter', async () => {
    await feedbackService.announceForExtension('extension.test', {
      id: 'v2',
      title: "What's new",
    });
    expect(feedbackService.activeAnnouncement?.title).toBe("What's new");

    feedbackService.reset();
    vi.mocked(feedbackCommands.acceptAnnouncement).mockResolvedValue(false);
    await feedbackService.announceForExtension('extension.test', {
      id: 'v2',
      title: 'Repeated',
    });
    expect(feedbackService.activeAnnouncement).toBeNull();
  });

  it('runs announcement actions only when clicked', async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    await feedbackService.announceFromHost({
      id: 'v2',
      title: "What's new",
      onClick,
      onDismiss,
    });
    feedbackService.onAnnouncementClicked();
    expect(onClick).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('registers and consumes retry handlers', async () => {
    const retry = vi.fn(async () => {});
    const id = feedbackService.registerRetry(retry);
    await feedbackService.triggerRetry(id);
    await feedbackService.triggerRetry(id);
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('confirmAlert', () => {
  it('resolves true when confirmed', async () => {
    const result = feedbackService.confirmAlert({ title: 'Delete?', message: 'Sure?' });
    feedbackService.onDialogConfirmed();
    await expect(result).resolves.toBe(true);
  });

  it('rejects a second concurrent dialog without replacing the first', async () => {
    const first = feedbackService.confirmAlert({ title: 'A', message: 'a' });
    await expect(feedbackService.confirmAlert({ title: 'B', message: 'b' })).resolves.toBe(false);
    expect(feedbackService.activeDialog?.title).toBe('A');
    feedbackService.onDialogCancelled();
    await expect(first).resolves.toBe(false);
  });
});

describe('HUD', () => {
  it('shows immediate feedback and hides the launcher', async () => {
    await feedbackService.showHUD('Copied');
    expect(commands.showHud).toHaveBeenCalledWith({
      title: 'Copied',
      durationMs: expect.any(Number),
      spinning: false,
    });
    expect(commands.hideWindow).toHaveBeenCalledOnce();
  });

  it('supports a spinning HUD for headless work', async () => {
    const handle = feedbackService.showHUDSpinning('Working');
    await handle.replace('Done');
    await handle.dismiss();
    expect(commands.showHud).toHaveBeenCalledWith({
      title: 'Working',
      durationMs: 0,
      spinning: true,
    });
    expect(commands.hideHud).toHaveBeenCalledOnce();
  });
});
