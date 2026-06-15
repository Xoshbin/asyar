import { describe, it, expect, beforeEach } from 'vitest';
import { feedbackViewState } from './feedbackState.svelte';

describe('feedbackViewState', () => {
  beforeEach(() => feedbackViewState.reset());

  it('defaults to idea category and empty message', () => {
    expect(feedbackViewState.category).toBe('idea');
    expect(feedbackViewState.message).toBe('');
  });

  it('reports canSubmit only when message is non-empty', () => {
    expect(feedbackViewState.canSubmit).toBe(false);
    feedbackViewState.message = 'something';
    expect(feedbackViewState.canSubmit).toBe(true);
    feedbackViewState.message = '   ';
    expect(feedbackViewState.canSubmit).toBe(false);
  });

  it('builds the FeedbackInput payload', () => {
    feedbackViewState.category = 'bug';
    feedbackViewState.message = 'broke';
    feedbackViewState.email = 'x@y.com';
    expect(feedbackViewState.toInput()).toEqual({
      type: 'feedback',
      category: 'bug',
      message: 'broke',
      email: 'x@y.com',
    });
  });

  it('sends null email when blank', () => {
    feedbackViewState.message = 'hi';
    feedbackViewState.email = '';
    expect(feedbackViewState.toInput().email).toBeNull();
  });
});
