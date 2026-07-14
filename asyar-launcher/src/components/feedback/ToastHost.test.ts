// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

if (!Element.prototype.animate) {
  Element.prototype.animate = () =>
    ({
      cancel: () => {},
      finish: () => {},
      finished: Promise.resolve(),
      onfinish: null,
      play: () => {},
      pause: () => {},
    }) as unknown as Animation;
}

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('../../lib/ipc/commands', () => ({
  showHud: vi.fn(async () => {}),
  hideHud: vi.fn(async () => {}),
  hideWindow: vi.fn(async () => {}),
}));
vi.mock('../../services/feedback/internal/feedbackCommands', () => ({}));
vi.mock('../../services/notification/notificationService', () => ({
  notificationService: {},
}));
vi.mock('../index', async () => ({
  IconButton: (await import('../base/IconButton.svelte')).default,
}));

import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import ToastHost from './ToastHost.svelte';

beforeEach(() => {
  feedbackService.reset();
});

describe('ToastHost', () => {
  it('lets users dismiss a non-actionable rare announcement', async () => {
    feedbackService.activeAnnouncement = {
      id: 'release-1',
      title: 'SDK Playground announcement',
      extensionId: 'org.asyar.sdk-playground',
    };

    render(ToastHost);
    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));

    expect(feedbackService.activeAnnouncement).toBeNull();
  });
});
