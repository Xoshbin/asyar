import type { FeedbackInput } from '../../lib/ipc/commands';

type Category = 'idea' | 'bug' | 'other';

class FeedbackViewState {
  category = $state<Category>('idea');
  message = $state('');
  email = $state('');
  submitting = $state(false);

  canSubmit = $derived(this.message.trim().length > 0 && !this.submitting);

  toInput(): FeedbackInput {
    const email = this.email.trim();
    return {
      type: 'feedback',
      category: this.category,
      message: this.message.trim(),
      email: email.length > 0 ? email : null,
    };
  }

  reset(): void {
    this.category = 'idea';
    this.message = '';
    this.email = '';
    this.submitting = false;
  }
}

export const feedbackViewState = new FeedbackViewState();
