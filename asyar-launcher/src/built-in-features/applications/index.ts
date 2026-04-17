import type { Extension, ExtensionContext } from 'asyar-sdk';

// Settings-only built-in: results come from the Rust search index.
class ApplicationsExtension implements Extension {
  onUnload = () => {};

  async initialize(_context: ExtensionContext): Promise<void> {}
  async executeCommand(): Promise<any> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}

export default new ApplicationsExtension();
