/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../feedback/feedbackService.svelte', () => ({
  feedbackService: { showToast: vi.fn() },
}));

import { feedbackService } from '../feedback/feedbackService.svelte';
import { extensionDegradedState } from './extensionDegradedState.svelte';

describe('extensionDegradedState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionDegradedState.reset();
  });

  it('first user-facing notice shows a toast', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(feedbackService.showToast).toHaveBeenCalledTimes(1);
  });

  it('subsequent notices within a session are deduped', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(feedbackService.showToast).toHaveBeenCalledTimes(1);
  });

  it('recovery resets dedupe for future Degraded', () => {
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    extensionDegradedState.recovered('ext.a');
    extensionDegradedState.noticeForUser('ext.a', 'Ext A', 3);
    expect(feedbackService.showToast).toHaveBeenCalledTimes(2);
  });
});
