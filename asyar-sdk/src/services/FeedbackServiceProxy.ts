import type {
  BackgroundFeedbackOptions,
  ConfirmAlertOptions,
  FeedbackAnnouncement,
  FeedbackProgressHandle,
  FeedbackProgressOptions,
  FeedbackReport,
  IFeedbackService,
} from './IFeedbackService';
import { BaseServiceProxy } from './BaseServiceProxy';

/**
 * SDK proxy for the host's `feedbackService`.
 *
 * Both Tier 1 (built-in features running in the launcher window) and Tier 2
 * (sandboxed iframes) consume this same proxy via
 * `context.proxies.feedback`. Every call serializes to a postMessage
 * routed through `MessageBroker` → `ExtensionIpcRouter` → host
 * `feedbackService`.
 *
 * Options objects are wrapped as `{ options }` so the router's generic
 * dispatch (`Object.values(payload)` → positional args) yields a single
 * positional argument that matches the host method signature.
 */
export class FeedbackServiceProxy extends BaseServiceProxy implements IFeedbackService {
  /** Default IPC timeout for confirm dialogs — users may take time. */
  private static readonly CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

  report(feedback: FeedbackReport): Promise<void> {
    return this.broker.invoke<void>('feedback:report', { feedback });
  }

  async showProgress(options: FeedbackProgressOptions): Promise<FeedbackProgressHandle> {
    const broker = this.broker;
    const feedbackId = await broker.invoke<string>('feedback:showProgress', { options });

    return {
      update: (update) => broker.invoke<void>('feedback:updateProgress', { feedbackId, update }),
      succeed: (title) =>
        broker.invoke<void>('feedback:finishProgress', {
          feedbackId,
          outcome: { severity: 'success', title },
        }),
      fail: (title, developerDetail) =>
        broker.invoke<void>('feedback:finishProgress', {
          feedbackId,
          outcome: { severity: 'error', title, developerDetail },
        }),
      dismiss: () => broker.invoke<void>('feedback:dismiss', { feedbackId }),
    };
  }

  announce(announcement: FeedbackAnnouncement): Promise<void> {
    return this.broker.invoke<void>('feedback:announce', { announcement });
  }

  sendBackground(options: BackgroundFeedbackOptions): Promise<string> {
    return this.broker.invoke<string>('feedback:sendBackground', { options });
  }

  dismissBackground(feedbackId: string): Promise<void> {
    return this.broker.invoke<void>('feedback:dismissBackground', { feedbackId });
  }

  showHUD(title: string): Promise<void> {
    return this.broker.invoke<void>('feedback:showHUD', { title });
  }

  confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
    return this.broker.invoke<boolean>(
      'feedback:confirmAlert',
      { options },
      undefined,
      FeedbackServiceProxy.CONFIRM_TIMEOUT_MS,
    );
  }
}
