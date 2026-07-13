// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const feedbackService = vi.hoisted(() => ({
  current: {
    id: 'feedback-error',
    source: 'extension' as const,
    kind: 'playground_error',
    severity: 'error' as const,
    retryable: false,
    context: { message: 'Stuck error' },
  },
  dismiss: vi.fn(async () => {}),
  triggerRetry: vi.fn(async () => {}),
  triggerReport: vi.fn(async () => {}),
}));

vi.mock('../../services/feedback/feedbackService.svelte', () => ({ feedbackService }));
vi.mock('../index', async () => ({
  FeedbackMessage: (await import('../feedback/FeedbackMessage.svelte')).default,
  KeyboardHint: (await import('../base/KeyboardHint.svelte')).default,
  StatusDot: (await import('../base/StatusDot.svelte')).default,
}));

import FeedbackBar from './FeedbackBar.svelte';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('FeedbackBar', () => {
  it('opens feedback details from the message instead of a separate Details button', async () => {
    render(FeedbackBar);

    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Stuck error' }));

    expect(screen.getByRole('heading', { name: 'Feedback details' })).not.toBeNull();
  });
});
