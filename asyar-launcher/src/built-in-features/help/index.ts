import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
  ILogService,
  ExtensionAction,
} from 'asyar-sdk/contracts';
import { openUrl } from '@tauri-apps/plugin-opener';
import { actionService } from '../../services/action/actionService.svelte';
import { helpViewState } from './helpState.svelte';
import { GUIDE_BASE_URL, guideUrl } from './topics';
import DefaultView from './DefaultView.svelte';

const VIEW_PATH = 'help/DefaultView';
const OPEN_GUIDE_ACTION_ID = 'help:open-user-guide';

class HelpExtension implements Extension {
  onUnload = () => {};
  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private isViewActive = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.logService = context.getService<ILogService>('log');
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'show-help') {
      helpViewState.reset();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async onViewSearch(query: string): Promise<void> {
    helpViewState.setSearch(query);
  }

  async viewActivated(_viewPath: string): Promise<void> {
    if (this.isViewActive) return;
    this.isViewActive = true;
    window.addEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel('Open Guide');
    this.registerViewActions();
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel(null);
    actionService.unregisterAction(OPEN_GUIDE_ACTION_ID);
    this.isViewActive = false;
  }

  /** Opens the guide page for the currently selected topic. */
  async openSelectedTopic(): Promise<void> {
    const topic = helpViewState.selected;
    if (topic) await openUrl(guideUrl(topic.slug));
  }

  private registerViewActions(): void {
    const openGuide: ExtensionAction = {
      id: OPEN_GUIDE_ACTION_ID,
      title: 'Open User Guide',
      description: 'Open the full Asyar user guide in your browser',
      icon: 'icon:globe',
      extensionId: 'help',
      category: 'help-action',
      execute: async () => {
        await openUrl(GUIDE_BASE_URL);
      },
    };
    actionService.registerAction(openGuide);
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        helpViewState.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        helpViewState.move(-1);
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        void this.openSelectedTopic();
        break;
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new HelpExtension();
export { DefaultView };
