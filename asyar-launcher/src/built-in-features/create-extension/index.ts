import type { Extension, ExtensionContext, IExtensionManager } from "asyar-sdk/contracts";
import { ActionContext } from "asyar-sdk/contracts";
import DefaultView from "./CreateExtensionView.svelte";
import BuildProgressView from "./ai-builder/BuildProgressView.svelte";
import CreatedExtensionsView from "./ai-builder/CreatedExtensionsView.svelte";
import { aiBuildUiState } from "./ai-builder/aiBuildUiState.svelte";
import { ensureListening } from "./ai-builder/orchestrator";
import { createdExtensionsViewState } from "./ai-builder/createdExtensionsViewState.svelte";
import { openInEditor } from "./ai-builder/openInEditor";
import { publishExtension } from "./ai-builder/publishExtension";
import { actionService } from "../../services/action/actionService.svelte";

class CreateExtension implements Extension {
  private extensionManager?: IExtensionManager;
  private myExtKeydownBound = (e: KeyboardEvent) => this.handleMyExtKeydown(e);

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

    context.registerCommand("my-extensions", {
      execute: async () => {
        this.extensionManager?.navigateToView("create-extension/CreatedExtensionsView");
      }
    });
  }

  private async handleMyExtKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      createdExtensionsViewState.moveSelection(e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    if (e.key === 'Enter') {
      const sel = createdExtensionsViewState.selectedItem;
      if (sel) { e.preventDefault(); await openInEditor(sel.path); }
    }
  }

  async executeCommand(commandId: string, args?: Record<string, any>) {
    if (commandId === "open") {
      this.extensionManager?.navigateToView("create-extension/DefaultView");
    } else if (commandId === "build-with-ai") {
      if (args?.buildId) aiBuildUiState.openTrigger = String(args.buildId);
      this.extensionManager?.navigateToView("create-extension/BuildProgressView");
    } else if (commandId === "my-extensions") {
      this.extensionManager?.navigateToView("create-extension/CreatedExtensionsView");
    }
  }

  async viewActivated(viewId: string): Promise<void> {
    if (viewId.endsWith('CreatedExtensionsView')) {
      window.addEventListener('keydown', this.myExtKeydownBound);
      await createdExtensionsViewState.load();
      this.extensionManager?.setActiveViewActionLabel('Open');
      actionService.registerAction({
        id: 'ai-builder:open-created',
        label: 'Open in editor',
        icon: 'icon:terminal',
        description: 'Open the selected extension in your editor',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const s = createdExtensionsViewState.selectedItem;
          if (s) await openInEditor(s.path);
        },
      });
      actionService.registerAction({
        id: 'ai-builder:publish-created',
        label: 'Publish to Asyar Store',
        icon: 'icon:cloud-upload',
        description: 'Publish the selected extension to the Asyar Store',
        category: 'AI Builder',
        extensionId: 'create-extension',
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          const s = createdExtensionsViewState.selectedItem;
          if (s) await publishExtension(s.path);
        },
      });
    }
  }

  async viewDeactivated(viewId: string): Promise<void> {
    if (viewId.endsWith('CreatedExtensionsView')) {
      window.removeEventListener('keydown', this.myExtKeydownBound);
      this.extensionManager?.setActiveViewActionLabel(null);
      actionService.unregisterAction('ai-builder:open-created');
      actionService.unregisterAction('ai-builder:publish-created');
      createdExtensionsViewState.reset();
    }
  }

  async onViewSearch(query: string): Promise<void> {
    await createdExtensionsViewState.setSearch(query);
  }

  async activate() {}
  async deactivate() {}
  async onUnload() {}
}

export default new CreateExtension();
export { DefaultView, BuildProgressView, CreatedExtensionsView };
