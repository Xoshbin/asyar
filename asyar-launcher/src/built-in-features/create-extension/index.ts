import type { Extension, ExtensionContext, IExtensionManager } from "asyar-sdk";
import DefaultView from "./CreateExtensionView.svelte";

class CreateExtension implements Extension {
  private extensionManager?: IExtensionManager;
  async initialize(context: ExtensionContext) {
    this.extensionManager = context.getService<IExtensionManager>("extensions");
    context.registerCommand("open", {
      execute: async () => {
        this.extensionManager?.navigateToView("create-extension/DefaultView");
      }
    });
  }

  async executeCommand(commandId: string, args?: Record<string, any>) {
    if (commandId === "open") {
      this.extensionManager?.navigateToView("create-extension/DefaultView");
    }
  }
  async activate() {}
  async deactivate() {}
  async viewActivated() {}
  async viewDeactivated() {}
  async onUnload() {}
}

export default new CreateExtension();
export { DefaultView };
