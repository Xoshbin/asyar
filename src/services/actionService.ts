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
  context?: string; // Add context property to differentiate core vs extension actions
  execute: () => Promise<void> | void;
}

// Create a store for actions
export const actionStore = writable<ApplicationAction[]>([]);

// Action context types
export enum ActionContext {
  CORE = "core", // Built-in app actions
  EXTENSION_VIEW = "view", // Extension-specific view actions
  RESULT = "result", // Result-specific actions
}

/**
 * ActionService implementation for the main application
 * Connects extension actions to the application UI
 */
export class ActionService implements IActionService {
  private static instance: ActionService;
  private actions: Map<string, ApplicationAction> = new Map();
  private currentContext: string = ActionContext.CORE;

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
   * Set the current action context (core, view, result)
   */
  setContext(context: string): void {
    if (this.currentContext !== context) {
      this.currentContext = context;
      logService.debug(`Action context set to: ${context}`);
      this.updateStore();
    }
  }

  /**
   * Get the current action context
   */
  getContext(): string {
    return this.currentContext;
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
      category: action.category,
      context: action.category?.includes("result")
        ? ActionContext.RESULT
        : ActionContext.EXTENSION_VIEW,
      execute: action.execute,
    };

    this.actions.set(action.id, appAction);
    logService.debug(
      `Registered action: ${action.id} from ${action.extensionId}, context: ${appAction.context}`
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
    return Array.from(this.actions.values())
      .filter(this.filterActionsByContext.bind(this))
      .map((action) => ({
        id: action.id,
        title: action.label,
        description: action.description,
        icon: action.icon,
        extensionId: action.extensionId || "core",
        execute: action.execute,
      }));
  }

  /**
   * Filter actions based on current context
   */
  private filterActionsByContext(action: ApplicationAction): boolean {
    // Always include actions for the current context
    if (action.context === this.currentContext) {
      return true;
    }

    // Only show core actions if no extension actions are available for the current context
    if (action.context === ActionContext.CORE) {
      // Count how many extension/result actions we have for the current context
      const contextActionCount = Array.from(this.actions.values()).filter(
        (a) => a.context === this.currentContext
      ).length;

      // If we have extension/result actions, don't show core actions
      return contextActionCount === 0;
    }

    return false;
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
      context: ActionContext.CORE,
      execute: async () => {
        // This will be handled in the page.svelte component
      },
    });

    // Update the store
    this.updateStore();
  }

  /**
   * Update the action store with current actions
   */
  private updateStore() {
    // Filter actions based on context before updating the store
    const filteredActions = Array.from(this.actions.values()).filter(
      this.filterActionsByContext.bind(this)
    );

    actionStore.set(filteredActions);
  }
}

export const actionService = ActionService.getInstance();
