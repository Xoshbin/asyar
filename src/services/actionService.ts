import { writable } from "svelte/store";
import { logService } from "./logService";
import type {
  ExtensionAction,
  IActionService,
} from "asyar-extension-sdk/dist/types";

export interface ApplicationAction {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  category?: string;
  extensionId?: string;
  disabled?: boolean;
  execute: () => Promise<void> | void;
}

// Create a store for actions
export const actionStore = writable<ApplicationAction[]>([]);

/**
 * ActionService implementation for the main application
 * Connects extension actions to the application UI
 */
export class ActionService implements IActionService {
  private static instance: ActionService;
  private actions: Map<string, ApplicationAction> = new Map();

  private constructor() {
    // Register built-in actions
    this.registerBuiltInActions();
  }

  public static getInstance(): ActionService {
    if (!ActionService.instance) {
      ActionService.instance = new ActionService();
    }
    return ActionService.instance;
  }

  /**
   * Register an action from an extension
   */
  registerAction(action: ExtensionAction): void {
    const appAction: ApplicationAction = {
      id: action.id,
      label: action.title,
      icon: action.icon,
      description: action.description,
      extensionId: action.extensionId,
      execute: action.execute,
    };

    this.actions.set(action.id, appAction);
    logService.debug(
      `Registered action: ${action.id} from ${action.extensionId}`
    );

    // Update the store
    this.updateStore();
  }

  /**
   * Unregister an action
   */
  unregisterAction(actionId: string): void {
    this.actions.delete(actionId);
    logService.debug(`Unregistered action: ${actionId}`);

    // Update the store
    this.updateStore();
  }

  /**
   * Get all registered actions
   */
  getActions(): ExtensionAction[] {
    // Transform internal ApplicationAction to the ExtensionAction interface
    return Array.from(this.actions.values()).map((action) => ({
      id: action.id,
      title: action.label,
      description: action.description,
      icon: action.icon,
      extensionId: action.extensionId || "core",
      execute: action.execute,
    }));
  }

  /**
   * Execute an action by ID
   */
  async executeAction(actionId: string): Promise<void> {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    try {
      await action.execute();
    } catch (error) {
      logService.error(`Error executing action ${actionId}: ${error}`);
      throw error;
    }
  }

  /**
   * Register built-in application actions
   */
  private registerBuiltInActions() {
    // Settings action
    this.actions.set("settings", {
      id: "settings",
      label: "Settings",
      icon: "⚙️",
      description: "Configure application settings",
      execute: async () => {
        // This will be handled in the page.svelte component
      },
    });

    // Clipboard history action
    // this.actions.set("clipboard", {
    //   id: "clipboard",
    //   label: "Clipboard History",
    //   icon: "📋",
    //   description: "View your clipboard history",
    //   execute: async () => {
    //     // This will be handled in the page.svelte component
    //   },
    // });

    // // Help action
    // this.actions.set("help", {
    //   id: "help",
    //   label: "Help & Documentation",
    //   icon: "❓",
    //   description: "View documentation and help",
    //   execute: async () => {},
    // });

    // Update the store
    this.updateStore();
  }

  /**
   * Update the action store with current actions
   */
  private updateStore() {
    actionStore.set(Array.from(this.actions.values()));
  }
}

export const actionService = ActionService.getInstance();
