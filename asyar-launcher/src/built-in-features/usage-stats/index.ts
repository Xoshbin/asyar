import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
  ILogService,
} from 'asyar-sdk/contracts';
import { ActionContext } from 'asyar-sdk/contracts';
import { usageStatsState } from './usageStatsState.svelte';
import DefaultView from './DefaultView.svelte';
import { actionService } from '../../services/action/actionService.svelte';
import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
import { sendUsageNow } from '../../lib/ipc/commands';

const VIEW_PATH = 'usage-stats/DefaultView';
const ACTION_SEND_NOW = 'usage-stats:send-now';

class UsageStatsExtension implements Extension {
  onUnload = () => {};
  private logService?: ILogService;
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'open-usage-stats') {
      await usageStatsState.load();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async viewActivated(_viewId: string): Promise<void> {
    // Explicit user action — always sends regardless of the usageShareMode
    // setting (the click is consent, parallel to "Send feedback"). Lives in the
    // action panel to keep the view body clean and keyboard-first.
    actionService.registerAction({
      id: ACTION_SEND_NOW,
      title: 'Send usage now',
      description: "Send today's anonymous usage snapshot to Asyar now",
      icon: 'icon:cloud-upload',
      category: 'Usage Stats',
      extensionId: 'usage-stats',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        try {
          const count = await sendUsageNow();
          diagnosticsService.report({
            source: 'frontend',
            kind: 'manual',
            severity: 'success',
            retryable: false,
            context: { message: `Usage sent (${count} ${count === 1 ? 'event' : 'events'})` },
          });
        } catch (e) {
          diagnosticsService.report({
            source: 'frontend',
            kind: 'manual',
            severity: 'error',
            retryable: false,
            context: { message: 'Failed to send usage. Please try again.' },
            developerDetail: String(e),
          });
        }
      },
    });
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    actionService.unregisterAction(ACTION_SEND_NOW);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new UsageStatsExtension();
export { DefaultView };
