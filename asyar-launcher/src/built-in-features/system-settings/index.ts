import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { registerBuiltinDynamicDispatcher } from '../../services/extension/builtinDynamicDispatchers';
import { dispatchSettingsPaneCommand } from './dispatch';
import { registerSettingsPaneCommands, unregisterSettingsPaneCommands } from './manager';

registerBuiltinDynamicDispatcher('system-settings', dispatchSettingsPaneCommand);

class SystemSettingsExtension implements Extension {
  async initialize(_context: ExtensionContext): Promise<void> {}

  async activate(): Promise<void> {
    await registerSettingsPaneCommands();
  }

  async deactivate(): Promise<void> {
    await unregisterSettingsPaneCommands();
  }

  async executeCommand(commandId: string): Promise<unknown> {
    await dispatchSettingsPaneCommand(commandId);
    return { type: 'no-view' };
  }
}

const extension = new SystemSettingsExtension();
export default extension;
