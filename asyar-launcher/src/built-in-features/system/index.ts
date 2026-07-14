import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import { dispatchSystemCommand } from './dispatch';
import { registerSystemCommands, unregisterSystemCommands } from './manager';

registerBuiltinDynamicDispatcher('system', dispatchSystemCommand);

class SystemExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    await registerSystemCommands();
  }

  async deactivate(): Promise<void> {
    await unregisterSystemCommands();
  }

  async executeCommand(commandId: string): Promise<unknown> {
    await dispatchSystemCommand(commandId);
    return { type: 'no-view' };
  }
}

const extension = new SystemExtension();
export default extension;
