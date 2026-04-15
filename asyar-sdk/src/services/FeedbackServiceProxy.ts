import type {
  IFeedbackService,
  ShowToastOptions,
  ConfirmAlertOptions,
} from "./IFeedbackService";
import { BaseServiceProxy } from "./BaseServiceProxy";

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
export class FeedbackServiceProxy
  extends BaseServiceProxy
  implements IFeedbackService
{
  /** Default IPC timeout for confirm dialogs — users may take time. */
  private static readonly CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

  showToast(options: ShowToastOptions): Promise<string> {
    return this.broker.invoke<string>("feedback:showToast", { options });
  }

  updateToast(
    toastId: string,
    options: Partial<ShowToastOptions>,
  ): Promise<void> {
    return this.broker.invoke<void>("feedback:updateToast", {
      toastId,
      options,
    });
  }

  hideToast(toastId: string): Promise<void> {
    return this.broker.invoke<void>("feedback:hideToast", { toastId });
  }

  showHUD(title: string): Promise<void> {
    return this.broker.invoke<void>("feedback:showHUD", { title });
  }

  confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
    return this.broker.invoke<boolean>(
      "feedback:confirmAlert",
      { options },
      undefined,
      FeedbackServiceProxy.CONFIRM_TIMEOUT_MS,
    );
  }
}
