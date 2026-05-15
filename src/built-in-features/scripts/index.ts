import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { scriptsManager } from './scriptsManager.svelte';
import { dispatchScriptCommand } from './dispatch';
import ScriptsManagerView from './ScriptsManagerView.svelte';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';

export { ScriptsManagerView };

registerBuiltinDynamicDispatcher('scripts', dispatchScriptCommand);

class ScriptsExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    await scriptsManager.start();
  }

  async deactivate(): Promise<void> {
    await scriptsManager.stop();
  }

  async executeCommand(commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    if (commandId === 'manage-scripts') {
      return { type: 'view', viewPath: 'scripts/ScriptsManagerView' };
    }
    await dispatchScriptCommand(commandId, args);
    return { type: 'no-view' };
  }
}

const extension = new ScriptsExtension();
export default extension;
