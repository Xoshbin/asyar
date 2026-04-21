import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { showSettingsWindow } from '../../lib/ipc/commands';

class SettingsExtension implements Extension {
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'open-settings') {
      await showSettingsWindow();
      return { type: 'no-view' };
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new SettingsExtension();
