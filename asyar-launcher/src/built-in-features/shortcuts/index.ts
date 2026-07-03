import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
// @ts-ignore
import DefaultView from './DefaultView.svelte';
import { shortcutStore } from './shortcutStore.svelte';
import { shortcutViewState } from './shortcutViewState.svelte';

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

  async viewActivated(_viewId: string): Promise<void> {
    this.inView = true;
    window.addEventListener('keydown', this.handleKeydownBound);
  }

  async viewDeactivated(_viewId: string): Promise<void> {
    this.inView = false;
    window.removeEventListener('keydown', this.handleKeydownBound);
    shortcutViewState.reset();
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new ShortcutsExtension();
export { DefaultView };
