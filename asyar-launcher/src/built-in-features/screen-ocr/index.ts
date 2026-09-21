import type { Extension, ExtensionContext } from 'asyar-sdk/contracts';
import { ocrCaptureScreenText } from '../../lib/ipc/commands';

class ScreenOcrExtension implements Extension {
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}

  async executeCommand(commandId: string): Promise<any> {
    if (commandId === 'capture-text') {
      return await ocrCaptureScreenText();
    }
    return undefined;
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new ScreenOcrExtension();
