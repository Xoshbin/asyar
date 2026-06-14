import { submitFeedback, type FeedbackInput } from '../../lib/ipc/commands';

export class FeedbackSubmitService {
  /** Thin dispatch — all assembly and network logic lives in Rust. */
  async submit(input: FeedbackInput): Promise<void> {
    return submitFeedback(input);
  }
}

export const feedbackSubmitService = new FeedbackSubmitService();
