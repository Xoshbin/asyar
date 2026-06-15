import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
  ILogService,
} from 'asyar-sdk/contracts';
import { feedbackViewState } from './feedbackState.svelte';
import DefaultView from './DefaultView.svelte';

const VIEW_PATH = 'feedback/DefaultView';

class FeedbackExtension implements Extension {
  onUnload = () => {};
  private logService?: ILogService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'send-feedback') {
      feedbackViewState.reset();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new FeedbackExtension();
export { DefaultView };
