import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
  ILogService,
  ExtensionAction,
  ExtensionResult,
} from 'asyar-sdk/contracts';
import { actionService } from '../../services/action/actionService.svelte';
import { walkthroughService } from '../../services/walkthrough/walkthroughService.svelte';
import { walkthroughViewState } from './walkthroughViewState.svelte';
import DefaultView from './DefaultView.svelte';

const VIEW_PATH = 'walkthrough/DefaultView';
const COMPLETE_ACTION_ID = 'walkthrough:mark-complete';
const COMPLETE_ALL_ACTION_ID = 'walkthrough:mark-all-complete';
const DISMISS_ACTION_ID = 'walkthrough:dismiss';
const RESET_ACTION_ID = 'walkthrough:reset';

class WalkthroughExtension implements Extension {
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
    if (commandId === 'show-walkthrough') {
      walkthroughViewState.reset();
      void walkthroughService.refresh();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async onViewSearch(query: string): Promise<void> {
    await walkthroughViewState.setSearch(query);
  }

  /**
   * The root-search progress row. Only on the empty query — once the user
   * types, the ordinary `Walkthrough` command result covers it and a second
   * row would just be noise. Disappears for good at 100% or on dismiss.
   */
  async search(query: string): Promise<ExtensionResult[]> {
    if (query.trim() !== '') return [];
    if (!walkthroughService.shouldShowInRoot) return [];

    const { completed, total } = walkthroughService.progress;
    return [
      {
        score: 1.0,
        title: 'Beyond the basics',
        subtitle: `${completed} of ${total} tasks — learn what Asyar can really do`,
        type: 'result',
        icon: 'icon:star',
        priority: 'top',
        action: async () => {
          await this.openWalkthrough();
        },
      },
    ];
  }

  /**
   * Routes through the real command rather than navigating directly, so the
   * row records a launch like any other — which is what ticks the "start"
   * task off. Imported lazily to keep the module graph acyclic.
   */
  private async openWalkthrough(): Promise<void> {
    try {
      const { extensionManager } = await import('../../services/extension/extensionManager.svelte');
      await extensionManager.handleCommandAction('cmd_walkthrough_show-walkthrough');
    } catch (error) {
      this.logService?.error(`Failed to open the walkthrough: ${error}`);
      walkthroughViewState.reset();
      this.extensionManager?.navigateToView(VIEW_PATH);
    }
  }

  async viewActivated(_viewPath: string): Promise<void> {
    if (this.isViewActive) return;
    this.isViewActive = true;
    window.addEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel('Open Task');
    this.registerViewActions();
  }

  async viewDeactivated(_viewPath: string): Promise<void> {
    window.removeEventListener('keydown', this.handleKeydownBound);
    this.extensionManager?.setActiveViewActionLabel(null);
    for (const id of [
      COMPLETE_ACTION_ID,
      COMPLETE_ALL_ACTION_ID,
      DISMISS_ACTION_ID,
      RESET_ACTION_ID,
    ]) {
      actionService.unregisterAction(id);
    }
    this.isViewActive = false;
  }

  private registerViewActions(): void {
    const actions: ExtensionAction[] = [
      {
        id: COMPLETE_ACTION_ID,
        title: 'Mark as Complete',
        description: 'Tick this task off without doing it',
        icon: 'icon:star',
        extensionId: 'walkthrough',
        category: 'walkthrough-action',
        execute: async () => {
          const task = walkthroughViewState.openTask ?? walkthroughViewState.selected;
          if (!task) return;
          if (task.completed && task.source === 'manual') {
            await walkthroughService.uncomplete(task.id);
          } else {
            await walkthroughService.complete(task.id);
          }
        },
      },
      {
        id: COMPLETE_ALL_ACTION_ID,
        title: 'Mark All as Complete',
        description: 'Finish every remaining task at once',
        icon: 'icon:star',
        extensionId: 'walkthrough',
        category: 'walkthrough-action',
        execute: async () => {
          await walkthroughService.completeAll();
        },
      },
      {
        id: DISMISS_ACTION_ID,
        title: 'Hide Progress from Search',
        description: 'Stop showing the progress row in the main search list',
        icon: 'icon:eye',
        extensionId: 'walkthrough',
        category: 'walkthrough-action',
        execute: async () => {
          await walkthroughService.setDismissed(!walkthroughService.dismissed);
        },
      },
      {
        id: RESET_ACTION_ID,
        title: 'Restart Walkthrough',
        description: 'Forget hand-ticked tasks and start over',
        icon: 'icon:refresh',
        extensionId: 'walkthrough',
        category: 'walkthrough-action',
        execute: async () => {
          await walkthroughService.reset();
          walkthroughViewState.reset();
        },
      },
    ];

    for (const action of actions) actionService.registerAction(action);
  }

  /**
   * Arrow keys on the detail page scroll it. Focus stays in the launcher's
   * search input, so the scroller never receives the key event itself.
   */
  private scrollDetail(direction: 1 | -1): void {
    const scroller = document.querySelector<HTMLElement>('.walkthrough');
    scroller?.scrollBy({ top: direction * 80, behavior: 'smooth' });
  }

  private handleKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        if (walkthroughViewState.mode === 'detail') {
          this.scrollDetail(1);
          return;
        }
        walkthroughViewState.move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        if (walkthroughViewState.mode === 'detail') {
          this.scrollDetail(-1);
          return;
        }
        walkthroughViewState.move(-1);
        break;
      case 'Enter':
        if (walkthroughViewState.mode === 'detail') return;
        event.preventDefault();
        event.stopPropagation();
        walkthroughViewState.open();
        break;
      case 'Escape':
      case 'Backspace': {
        // Only swallow the key when it actually popped the detail page;
        // otherwise the launcher's own single-press dismiss must still fire.
        if (event.key === 'Backspace' && walkthroughViewState.mode !== 'detail') return;
        if (walkthroughViewState.back()) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      }
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new WalkthroughExtension();
export { DefaultView };
