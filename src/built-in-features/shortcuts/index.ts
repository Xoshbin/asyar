import type { Extension, ExtensionContext, IExtensionManager } from 'asyar-sdk/contracts';
// @ts-ignore
import DefaultView from './DefaultView.svelte';

class ShortcutsExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string, args?: Record<string, any>): Promise<any> {
    if (commandId === 'open-shortcuts') {
      this.extensionManager?.navigateToView('shortcuts/DefaultView');
      return { type: 'view', viewPath: 'shortcuts/DefaultView' };
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new ShortcutsExtension();
export { DefaultView };
