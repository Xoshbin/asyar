import { submitFeedback, type FeedbackInput } from '../../lib/ipc/commands';

export class FeedbackSubmitService {
  /** Thin dispatch — all assembly and network logic lives in Rust. */
  async submit(input: FeedbackInput): Promise<void> {
    const ok = await submitFeedback(input);
    if (!ok) throw new Error('submit_feedback failed');
  }
}

export const feedbackSubmitService = new FeedbackSubmitService();
