import { getActiveContext } from './context';
import type { IFeedbackService, FeedbackProgressHandle } from 'asyar-sdk/contracts';

export class Toast {
  public static Style = {
    Success: 'SUCCESS' as const,
    Failure: 'FAILURE' as const,
    Animated: 'ANIMATED' as const,
  };

  public title: string;
  public message?: string;
  public style: (typeof Toast.Style)[keyof typeof Toast.Style];
  public primaryAction?: { title: string; onAction: (toast: Toast) => void };
  public secondaryAction?: { title: string; onAction: (toast: Toast) => void };

  private progressHandle?: FeedbackProgressHandle;

  constructor(options: Toast.Options) {
    this.title = options.title;
    this.message = options.message;
    this.style = options.style;
    this.primaryAction = options.primaryAction;
    this.secondaryAction = options.secondaryAction;
  }

  private getFeedbackService(): IFeedbackService {
    return getActiveContext().getService<IFeedbackService>('feedback');
  }

  async show(): Promise<void> {
    const feedback = this.getFeedbackService();

    if (this.style === Toast.Style.Animated) {
      if (!this.progressHandle) {
        this.progressHandle = await feedback.showProgress({
          title: this.title,
        });
      } else {
        await this.progressHandle.update({
          title: this.title,
        });
      }
      return;
    }

    if (this.progressHandle) {
      if (this.style === Toast.Style.Success) {
        await this.progressHandle.succeed(this.title);
      } else if (this.style === Toast.Style.Failure) {
        await this.progressHandle.fail(this.title, this.message);
      } else {
        await this.progressHandle.dismiss();
      }
      return;
    }

    const severity =
      this.style === Toast.Style.Success
        ? 'success'
        : this.style === Toast.Style.Failure
          ? 'error'
          : 'info';

    await feedback.report({
      kind: 'toast',
      severity,
      retryable: false,
      context: { title: this.title },
      developerDetail: this.message || this.title,
    });
  }

  async hide(): Promise<void> {
    if (this.progressHandle) {
      await this.progressHandle.dismiss();
      this.progressHandle = undefined;
    }
  }
}

export namespace Toast {
  export type Style = (typeof Toast.Style)[keyof typeof Toast.Style];

  export interface Options {
    style: Style;
    title: string;
    message?: string;
    primaryAction?: { title: string; onAction: (toast: Toast) => void };
    secondaryAction?: { title: string; onAction: (toast: Toast) => void };
  }
}

export async function showToast(
  optionsOrStyle: Toast.Options | Toast.Style,
  title?: string,
  message?: string,
): Promise<Toast> {
  const options: Toast.Options =
    typeof optionsOrStyle === 'string'
      ? {
          style: optionsOrStyle,
          title: title ?? '',
          message,
        }
      : optionsOrStyle;

  const toast = new Toast(options);
  await toast.show();
  return toast;
}

export async function showHUD(
  title: string,
  _options?: { clearRootSearch?: boolean; popToRootType?: unknown },
): Promise<void> {
  const feedback = getActiveContext().getService<IFeedbackService>('feedback');
  await feedback.showHUD(title);
}
