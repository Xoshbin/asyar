import type {
  Extension,
  ExtensionContext,
  IExtensionManager,
} from 'asyar-sdk/contracts';
import { raycastImportState } from './raycastImportState.svelte';
import DefaultView from './DefaultView.svelte';

const VIEW_PATH = 'raycast-import/DefaultView';

class RaycastImportExtension implements Extension {
  onUnload = () => {};
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext): Promise<void> {
    this.extensionManager = context.getService<IExtensionManager>('extensions');
  }

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'import-raycast') {
      raycastImportState.reset();
      this.extensionManager?.navigateToView(VIEW_PATH);
      return { type: 'view', viewPath: VIEW_PATH };
    }
    throw new Error(`Unknown command: ${commandId}`);
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new RaycastImportExtension();
export { DefaultView };
