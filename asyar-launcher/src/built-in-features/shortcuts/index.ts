import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import ShortcutEditView from './ShortcutEditView.svelte';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';
import { viewManager } from '../../services/extension/viewManager.svelte';

class ShortcutsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;
  private inView = false;
  private handleKeydownBound = (e: KeyboardEvent) => this.handleKeydown(e);

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  private handleKeydown(e: KeyboardEvent) {
    if (!this.inView) return;
    if (shortcutStore.isCapturing) return; // let ShortcutRecorder own the keys while capturing

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      shortcutViewState.moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
    }
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-shortcuts') {
      this.extensionManager?.navigateToView('shortcuts/DefaultView');
      return { type: 'view', viewPath: 'shortcuts/DefaultView' };
    }
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId !== 'shortcuts/DefaultView') return;
    this.inView = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
      window.addEventListener('keydown', this.handleKeydownBound);
    }
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId === 'shortcuts/ShortcutEditView') {
      shortcutViewState.clearEdit();
      return;
    }
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    if (!viewManager.isViewInStack('shortcuts/DefaultView')) {
      shortcutViewState.reset();
    }
  }

  async activate(): Promise<void> {
    shortcutViewState.reset();
  }

  async deactivate(): Promise<void> {
    this.inView = false;
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeydownBound);
    }
    shortcutViewState.reset();
  }
}

export default new ShortcutsExtension();
export { DefaultView, ShortcutEditView };
