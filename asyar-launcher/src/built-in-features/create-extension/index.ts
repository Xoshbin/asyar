import type { Extension, ExtensionContext, IExtensionManager } from "asyar-sdk/contracts";
import DefaultView from "./CreateExtensionView.svelte";
import BuildProgressView from "./ai-builder/BuildProgressView.svelte";
import { aiBuildUiState } from "./ai-builder/aiBuildUiState.svelte";
import { ensureListening } from "./ai-builder/orchestrator";

class CreateExtension implements Extension {
  private extensionManager?: IExtensionManager;

  async initialize(context: ExtensionContext) {
    this.extensionManager = context.getService<IExtensionManager>("extensions");

    await ensureListening();

    context.registerCommand("open", {
      execute: async () => {
        this.extensionManager?.navigateToView("create-extension/DefaultView");
      }
    });

    context.registerCommand("build-with-ai", {
      execute: async (args?: Record<string, any>) => {
        if (args?.buildId) aiBuildUiState.openTrigger = String(args.buildId);
        this.extensionManager?.navigateToView("create-extension/BuildProgressView");
      }
    });
  }

  async executeCommand(commandId: string, args?: Record<string, any>) {
    if (commandId === "open") {
      this.extensionManager?.navigateToView("create-extension/DefaultView");
    } else if (commandId === "build-with-ai") {
      if (args?.buildId) aiBuildUiState.openTrigger = String(args.buildId);
      this.extensionManager?.navigateToView("create-extension/BuildProgressView");
    }
  }

  async activate() {}
  async deactivate() {}
  async viewActivated() {}
  async viewDeactivated() {}
  async onUnload() {}
}

export default new CreateExtension();
export { DefaultView, BuildProgressView };
