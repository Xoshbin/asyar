import { clipboardViewState } from "./state.svelte";
import DefaultView from './DefaultView.svelte'; // Import renamed component
import { actionService } from "../../services/action/actionService.svelte";
import { logService } from "../../services/log/logService";
import { contextModeService } from "../../services/context/contextModeService.svelte";
import { feedbackService } from "../../services/feedback/feedbackService.svelte";
import { searchStores } from "../../services/search/stores/search.svelte";
import { viewManager } from "../../services/extension/viewManager.svelte";

import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type Extension,
  type ExtensionContext,
  type ExtensionResult,
  type ILogService,
  type IExtensionManager,
  type IClipboardHistoryService,
  type ClipboardHistoryItem,
  ActionContext,
  ClipboardItemType,
} from "asyar-sdk";
import type { ExtensionAction, IActionService } from "asyar-sdk";
import { snippetUiState } from '../snippets/snippetUiState.svelte';

// Define static results for clipboard extension
const clipboardResults = [
  {
    id: "clipboard-history",
    title: "Clipboard History",
    subtitle: "View and manage your clipboard history",
    keywords: "clipboard copy paste history",
  },
];

/**
 * Returns the plain-text representation of the currently selected clipboard
 * item if it can be sent to a downstream context provider (AI Chat, portals,
 * etc.), or null otherwise. For unsupported types (Image / Files) this also
 * surfaces a "Not supported yet" toast naming the action and the type, so the
 * user understands why nothing happened. For "no selection" or "empty plain
 * text" this is a silent no-op.
 *
 * Both Phase 1 and Phase 2 actions use this helper — do not duplicate the
 * type check.
 */
async function assertTextSendable(actionTitle: string): Promise<string | null> {
  const item = clipboardViewState.selectedItem;
  if (!item) return null;

  if (
    item.type === ClipboardItemType.Image ||
    item.type === ClipboardItemType.Files
  ) {
    const typeName = item.type === ClipboardItemType.Image ? 'Image' : 'File';
    await feedbackService.showToast({
      title: 'Not supported yet',
      message: `${typeName} clipboard items can't be used with "${actionTitle}" yet.`,
      style: 'failure',
    });
    return null;
  }

  const text = clipboardViewState.getPlainText(item);
  if (!text.trim()) return null;
  return text;
}



class ClipboardHistoryExtension implements Extension {
  onUnload: any;

  private logService?: ILogService;
  private extensionManager?: IExtensionManager;
  private clipboardService?: IClipboardHistoryService;
  private inView: boolean = false;
  private context?: ExtensionContext;

  async initialize(context: ExtensionContext): Promise<void> {
    try {
      this.context = context;
      this.logService = context.getService<ILogService>("LogService");
      this.extensionManager =
        context.getService<IExtensionManager>("ExtensionManager");
      this.clipboardService = context.getService<IClipboardHistoryService>(
        "ClipboardHistoryService"
      );

      if (
        !this.logService ||
        !this.extensionManager ||
        !this.clipboardService
      ) {
        logService.error(
          "Failed to initialize required services for Clipboard History"
        );
        this.logService?.error(
          "Failed to initialize required services for Clipboard History"
        );
        return;
      }

      // Initialize state services
      clipboardViewState.initializeServices(context);

      this.logService.info(
        "Clipboard History extension initialized with services"
      );
    } catch (error) {
      logService.error(`Clipboard History initialization failed: ${error}`);
      this.logService?.error(
        `Clipboard History initialization failed: ${error}`
      );
    }
  }

  async executeCommand(
    commandId: string,
    args?: Record<string, any>
  ): Promise<any> {
    this.logService?.info(`Executing clipboard command: ${commandId}`);

    switch (commandId) {
      case "show-clipboard":
        // Pre-load clipboard items before navigating
        await this.refreshClipboardData(); // Ensure data is loaded before navigating

        this.extensionManager?.navigateToView(
          "clipboard-history/DefaultView"
        );
        // Register action when command is executed
        this.registerViewActions();
        return {
          type: "view",
          viewPath: "clipboard-history/DefaultView",
        };

      default:
        this.logService?.error(`Received unknown command ID: ${commandId}`);
        throw new Error(`Unknown command: ${commandId}`);
    }
  }

  // Called when this extension's view is activated
  async viewActivated(viewPath: string): Promise<void> {
    this.inView = true;
    this.logService?.debug(`Clipboard History view activated: ${viewPath}`);
    
    // Add global key listener
    window.addEventListener("keydown", this.handleKeydownBound);

    // Set the primary action label via the manager
    this.extensionManager?.setActiveViewActionLabel("Paste");
    // Actions are now registered when the command is executed.
    // Refresh data when view is activated (might be redundant if done in executeCommand, but safe)
    await this.refreshClipboardData();
  }

  private handleKeydownBound = (event: KeyboardEvent) => this.handleKeydown(event);

  private async handleKeydown(event: KeyboardEvent) {
    if (!this.inView) return;

    // We can't easily check filteredItems.length here without importing the state
    // But the state is already initialized.
    const state = clipboardViewState;
    if (!state.filteredItems.length) return;

    if (event.key === "Enter") {
      this.logService?.debug(`[clipboard] Enter pressed. selectedItem=${!!state.selectedItem}, items=${state.items.length}, activeElement=${document.activeElement?.tagName}`);
    }

    if ((event.metaKey || event.ctrlKey) && event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      if (state.selectedItem) {
        await clipboardViewState.deleteItem(state.selectedItem.id);
      }
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      clipboardViewState.moveSelection(event.key === "ArrowUp" ? 'up' : 'down');
    } else if (event.key === "Enter" && event.shiftKey && state.selectedItem) {
      event.preventDefault();
      event.stopPropagation();
      clipboardViewState.pasteAsPlainText();
    } else if (event.key === "Enter" && state.selectedItem) {
      event.preventDefault();
      event.stopPropagation();
      clipboardViewState.handleItemAction(state.selectedItem, 'paste');
    }
  }

  // Helper method to register view-specific actions
  private registerViewActions() {
    if (!this.clipboardService) {
      this.logService?.warn(
        "ClipboardService not available, cannot register view actions."
      );
      return;
    }
    this.logService?.debug("Registering clipboard view actions...");

    const resetHistoryAction: ExtensionAction = {
      id: "clipboard-history:clipboard-reset-history",
      title: "Clear Clipboard History",
      description: "Remove all non-favorite clipboard items",
      icon: "icon:trash",
      extensionId: "clipboard-history",
      category: "clipboard-action", // Context is implicitly EXTENSION_VIEW when registered
      confirm: true,
      execute: async () => {
        try {
          // Correct method call
          const success = await this.clipboardService?.clearNonFavorites();
          if (success) {
            this.logService?.info("Non-favorite clipboard history cleared");
          } else {
            this.logService?.warn(
              "Clearing non-favorite clipboard history reported failure."
            );
          }
          // Refresh the view with updated items
          await this.refreshClipboardData(); // Refresh after clearing
        } catch (error) {
          this.logService?.error(`Failed to clear clipboard history: ${error}`);
        }
      },
    };
    // Use registerAction from the service instance
    actionService.registerAction(resetHistoryAction);

    const filterActions: ExtensionAction[] = [
      {
        id: "clipboard-history:filter-all",
        title: "Filter: All Types",
        description: "Show all clipboard items",
        icon: "icon:filter",
        extensionId: "clipboard-history",
        category: "clipboard-action",
        execute: () => {
          clipboardViewState.setTypeFilter("all");
        },
      },
      {
        id: "clipboard-history:filter-text",
        title: "Filter: Text Only",
        description: "Show text, HTML, and RTF items",
        icon: "icon:type",
        extensionId: "clipboard-history",
        category: "clipboard-action",
        execute: () => {
          clipboardViewState.setTypeFilter("text");
        },
      },
      {
        id: "clipboard-history:filter-images",
        title: "Filter: Images Only",
        description: "Show image items only",
        icon: "icon:image",
        extensionId: "clipboard-history",
        category: "clipboard-action",
        execute: () => {
          clipboardViewState.setTypeFilter("images");
        },
      },
      {
        id: "clipboard-history:filter-files",
        title: "Filter: Files Only",
        description: "Show file items only",
        icon: "icon:file-text",
        extensionId: "clipboard-history",
        category: "clipboard-action",
        execute: () => {
          clipboardViewState.setTypeFilter("files");
        },
      },
    ];

    for (const action of filterActions) {
      actionService.registerAction(action);
    }

    const toggleHtmlAction: ExtensionAction = {
      id: "clipboard-history:toggle-html-view",
      title: "Toggle HTML Rendered/Source",
      description: "Switch between rendered HTML preview and raw source",
      icon: "icon:eye",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      execute: () => {
        clipboardViewState.toggleHtmlView();
      },
    };
    actionService.registerAction(toggleHtmlAction);

    const openInBrowserAction: ExtensionAction = {
      id: "clipboard-history:open-in-browser",
      title: "Open in Browser",
      description: "Open the selected URL in the default browser",
      icon: "icon:link",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      execute: async () => {
        const selected = clipboardViewState.selectedItem;
        if (selected?.content && /^https?:\/\/[^\s]+$/.test(selected.content.trim())) {
          await openUrl(selected.content.trim());
        }
      },
    };
    actionService.registerAction(openInBrowserAction);

    const pasteAsPlainTextAction: ExtensionAction = {
      id: "clipboard-history:paste-as-plain-text",
      title: "Paste as Plain Text",
      description: "Paste the selected item as plain text, stripping all formatting",
      icon: "icon:type",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      execute: async () => {
        await clipboardViewState.pasteAsPlainText();
      },
    };
    actionService.registerAction(pasteAsPlainTextAction);

    const toggleFavoriteAction: ExtensionAction = {
      id: "clipboard-history:toggle-favorite",
      title: "Toggle Favorite",
      description: "Pin or unpin the selected clipboard item",
      icon: "icon:star",
      extensionId: "clipboard-history",
      category: "clipboard-action",
      execute: async () => {
        const selected = clipboardViewState.selectedItem;
        if (selected) {
          await clipboardViewState.toggleFavorite(selected.id);
          await this.refreshClipboardData();
        }
      },
    };
    actionService.registerAction(toggleFavoriteAction);

    actionService.registerAction({
      id: 'clipboard-history:save-as-snippet',
      title: 'Save as Snippet',
      icon: 'icon:scissors',
      description: 'Open this clipboard item in the snippet editor',
      category: 'clipboard-action',
      extensionId: 'clipboard-history',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const item = clipboardViewState.selectedItem;
        if (!item || item.type === ClipboardItemType.Image || item.type === ClipboardItemType.Files) return;
        snippetUiState.prefillExpansion = clipboardViewState.getPlainText(item);
        snippetUiState.editorTrigger = 'add';
        this.extensionManager?.navigateToView('snippets/DefaultView');
      },
    });

    actionService.registerAction({
      id: 'clipboard-history:ask-ai-about-this',
      title: 'Ask AI about this',
      description: 'Open AI Chat with this clipboard text pre-filled',
      icon: 'icon:ai-chat',
      category: 'clipboard-action',
      extensionId: 'clipboard-history',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        const text = await assertTextSendable('Ask AI about this');
        if (!text) return;

        // Pop the clipboard view synchronously so its keydown listener + registered
        // actions are torn down via viewDeactivated BEFORE Svelte 5 flushes effects.
        // We call viewManager.goBack() directly (not this.extensionManager?.goBack())
        // because for built-in features the ExtensionManager returned by
        // context.getService is actually the async ExtensionManagerProxy that fires
        // a fire-and-forget postMessage IPC — its goBack would not take effect until
        // the next event-loop tick, and by then Effect 5 in searchController has
        // already seen state.activeViewVal=true and routed our new searchStores.query
        // into the clipboard view's onViewSearch, freezing the launcher. viewManager
        // is a host-internal module and built-in (Tier 1) features are allowed to
        // import it directly (see launcherKeyboard.ts, searchOrchestrator.svelte.ts).
        viewManager.goBack();

        // Force the AI hint chip to appear regardless of whether the clipboard text
        // looks like a natural-language question, then push the text into the main
        // search bar. Svelte 5 batches these two state mutations with the
        // viewManager state mutations from goBack above into a single effect flush,
        // so by the time Effect 5 in searchController computes the hint it sees:
        //   state.activeViewVal = null (goBack emptied the stack)
        //   state.localSearchValue = text (non-empty, final value)
        //   contextModeService.pinnedHintProviderId = 'ai-chat'
        // which makes getHint return the AI hint and routes through the "no active
        // view" branch of Effect 5 (NOT the "Search in extension" branch). User
        // presses Tab to commit, which activates AI chat with the text as the
        // initial query and auto-sends via the existing tryCommitContextHint path.
        contextModeService.pinHint('ai-chat');
        searchStores.query = text;
      },
    });
  }

  // Helper method to unregister view-specific actions
  private unregisterViewActions() {
    this.logService?.debug("Unregistering clipboard view actions...");
    // Use unregisterAction from the service instance
    actionService.unregisterAction("clipboard-history:clipboard-reset-history");
    actionService.unregisterAction("clipboard-history:filter-all");
    actionService.unregisterAction("clipboard-history:filter-text");
    actionService.unregisterAction("clipboard-history:filter-images");
    actionService.unregisterAction("clipboard-history:filter-files");
    actionService.unregisterAction("clipboard-history:toggle-html-view");
    actionService.unregisterAction("clipboard-history:toggle-favorite");
    actionService.unregisterAction("clipboard-history:paste-as-plain-text");
    actionService.unregisterAction("clipboard-history:open-in-browser");
    actionService.unregisterAction("clipboard-history:save-as-snippet");
    actionService.unregisterAction('clipboard-history:ask-ai-about-this');
  }

  // Called when this extension's view is deactivated
  async viewDeactivated(viewPath: string): Promise<void> {
    // Remove global key listener first
    window.removeEventListener("keydown", this.handleKeydownBound);

    // Unregister actions when the view is deactivated
    this.unregisterViewActions();
    // Clear the primary action label via the manager
    this.extensionManager?.setActiveViewActionLabel(null);
    this.inView = false;
    this.logService?.debug(`Clipboard History view deactivated: ${viewPath}`);
  }

  async onViewSearch(query: string): Promise<void> {
    // Make async
    clipboardViewState.setSearch(query);
  }

  private async refreshClipboardData() {
    if (this.clipboardService) {
      clipboardViewState.setLoading(true);
      try {
        const items = await this.clipboardService.getRecentItems(100);
        clipboardViewState.setItems(items || []); // Ensure items is an array
      } catch (error) {
        this.logService?.error(`Failed to load clipboard data: ${error}`);
        clipboardViewState.setError(`Failed to load clipboard data: ${error}`);
      } finally {
        clipboardViewState.setLoading(false);
      }
    } else {
      this.logService?.warn(
        "ClipboardService not available in refreshClipboardData"
      );
    }
  }

  async activate(): Promise<void> {
    this.logService?.info("Clipboard History extension activated");
  }

  async deactivate(): Promise<void> {
    // Ensure actions are unregistered if the extension is deactivated while view is active
    if (this.inView) {
      this.unregisterViewActions();
    }
    this.logService?.info("Clipboard History extension deactivated");
  }
}

export default new ClipboardHistoryExtension();

// Export component for dynamic loading
export { DefaultView };
