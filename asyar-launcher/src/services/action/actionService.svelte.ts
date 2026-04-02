import { logService } from "../log/logService";
import type { ExtensionAction, IActionService } from "asyar-sdk";
import { ActionContext } from "asyar-sdk";
import * as commands from "../../lib/ipc/commands";
import { searchService } from "../search/SearchService";

// This interface might need adjustment if ApplicationAction should also use the enum
export interface ApplicationAction {
  id: string;
  label: string;
  icon?: string;
  description?: string;
  category?: string;
  extensionId?: string;
  disabled?: boolean;
  context?: ActionContext; // Use the enum type here too for consistency
  confirm?: boolean;
  execute: () => Promise<void> | void;
  shortcut?: string;
}

/**
 * ActionService implementation for the main application
 * Connects extension actions to the application UI
 */
export class ActionService implements IActionService {
  private static instance: ActionService;
  private allActions: Map<string, ApplicationAction> = new Map();
  private currentContext: ActionContext = ActionContext.CORE;
  private sendToExtension?: (extensionId: string, actionId: string) => void;
  
  // Svelte 5 reactive state
  public filteredActions = $state<ApplicationAction[]>([]);

  private constructor() {
    this.registerBuiltInActions();
    this.updateState();
  }

  setExtensionForwarder(fn: (extensionId: string, actionId: string) => void): void {
    this.sendToExtension = fn;
  }

  public static getInstance(): ActionService {
    if (!ActionService.instance) {
      ActionService.instance = new ActionService();
    }
    return ActionService.instance;
  }

  /**
   * Set the current action context and optional data (e.g., commandId)
   */
  setContext(context: ActionContext): void {
    // Only update if context actually changes
    if (this.currentContext !== context) {
      this.currentContext = context;
      logService.debug(`Action context set to: ${context}`);
      this.updateState(); // Update the Svelte state with filtered actions
    }
  }

  /**
   * Get the current action context
   */
  getContext(): ActionContext {
    return this.currentContext;
  }

  /**
   * Register an action from an extension or core
   */
  registerAction(action: ExtensionAction | ApplicationAction): void {
    // Ensure it conforms to ApplicationAction structure internally
    const appAction: ApplicationAction = {
      id: action.id,
      label: "title" in action ? action.title : action.label, // Handle both interfaces
      icon: action.icon,
      description: action.description,
      extensionId: "extensionId" in action ? action.extensionId : undefined,
      category: action.category,
      // Use the context provided, default if necessary, ensure it's the enum type
      context: action.context || ActionContext.EXTENSION_VIEW,
      confirm: "confirm" in action ? action.confirm : undefined,
      shortcut: "shortcut" in action ? action.shortcut : undefined,
      execute: action.execute,
      disabled: "disabled" in action ? action.disabled : undefined,
    };

    this.allActions.set(appAction.id, appAction); // Store in the master list
    logService.debug(
      `Registered action: ${appAction.id} from ${
        appAction.extensionId || "core"
      }, context: ${appAction.context || "default"}`
    );

    // Update the state if the action matches the current context
    this.updateState();
  }

  /**
   * Unregister an action
   */
  unregisterAction(actionId: string): void {
    if (this.allActions.delete(actionId)) {
      logService.debug(`Unregistered action: ${actionId}`);
      // Update the state
      this.updateState();
    } else {
      logService.warn(
        `Attempted to unregister non-existent action: ${actionId}`
      );
    }
  }

  /**
   * Remove all actions registered by a specific extension.
   * Call this when an extension view is closed to prevent stale actions from persisting.
   */
  clearActionsForExtension(extensionId: string): void {
    let changed = false;
    for (const [id, action] of this.allActions) {
      if (action.extensionId === extensionId) {
        this.allActions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      logService.debug(`[ActionService] Cleared all actions for extension: ${extensionId}`);
      this.updateState();
    }
  }

  /**
   * Get all registered actions (primarily for internal use or debugging)
   * Note: This returns ALL actions, not filtered by context.
   */
  getAllActions(): ApplicationAction[] {
    return Array.from(this.allActions.values());
  }

  /**
   * Get actions filtered by the current context
   */
  private getFilteredActions(): ApplicationAction[] {
    const filtered = Array.from(this.allActions.values()).filter(
      this.filterActionsByContext.bind(this)
    );

    // Log details about filtered actions
    logService.debug(
      `Filtering actions for context: ${this.currentContext}. Found ${filtered.length} actions.`
    );

    return filtered;
  }

  /**
   * Get actions based on a specific context (implements IActionService method)
   */
  getActions(context?: ActionContext): ExtensionAction[] {
    const targetContext = context || this.currentContext;
    if (targetContext === ActionContext.COMMAND_RESULT) {
      logService.warn(
        "getActions(COMMAND_RESULT) called directly; may not return correct results."
      );
    }
    return Array.from(this.allActions.values())
      .filter((action) => action.context === targetContext) // Simple context filter for this specific method
      .map((action) => ({
        // Map back to ExtensionAction interface
        id: action.id,
        title: action.label,
        description: action.description,
        icon: action.icon,
        // Ensure extensionId is a string, default to 'core' if undefined
        extensionId: action.extensionId || "core",
        category: action.category,
        context: action.context, // Pass context through
        execute: action.execute,
      }));
  }

  /**
   * Filter actions based on the current internal context
   */
  private filterActionsByContext(action: ApplicationAction): boolean {
    // Handle specific contexts (EXTENSION_VIEW, CORE, etc.)
    if (action.context === this.currentContext) {
      return true;
    }

    // Handle GLOBAL actions - show them in CORE and EXTENSION_VIEW contexts
    if (
      action.context === ActionContext.GLOBAL &&
      (this.currentContext === ActionContext.CORE ||
        this.currentContext === ActionContext.EXTENSION_VIEW)
    ) {
      return true;
    }

    // Fallback: If context is CORE, show CORE actions only if no context-specific actions are available
    if (
      this.currentContext === ActionContext.CORE &&
      action.context === ActionContext.CORE
    ) {
      const specificActionCount = Array.from(this.allActions.values()).filter(
        (a) =>
          a.context === this.currentContext &&
          a.context !== ActionContext.CORE &&
          a.context !== ActionContext.GLOBAL
      ).length;
      return specificActionCount === 0;
    }

    return false;
  }

  /**
   * Execute an action by ID
   */
  async executeAction(actionId: string): Promise<void> {
    const action = this.allActions.get(actionId); // Get from the master list
    if (!action) {
      throw new Error(`Action not found: ${actionId}`);
    }

    logService.info(
      `Executing action: ${actionId} from ${action.extensionId || "core"}`
    );

    try {
      if (typeof action.execute === 'function') {
        await action.execute();
      } else if (action.extensionId && this.sendToExtension) {
        this.sendToExtension(action.extensionId, actionId);
      } else {
        throw new Error(`Action execute is not a function: ${actionId}`);
      }
    } catch (error) {
      logService.error(`Error executing action ${actionId}: ${error}`);
      throw error;
    }
  }

  /**
   * Register built-in application actions
   */
  private registerBuiltInActions() {
    this.registerAction({
      id: "settings",
      label: "Settings",
      icon: "icon:settings",
      description: "Configure application settings",
      category: "System",
      context: ActionContext.CORE,
      execute: async () => {
        logService.info("Executing built-in action: Open Settings");
        try {
          await commands.showSettingsWindow();
        } catch (err) {
          logService.error(`Failed to open settings window: ${err}`);
        }
      },
    });

    this.registerAction({
      id: "reset_search",
      label: "Reset Search Index",
      icon: "🔄",
      description: "Reset the search index",
      category: "System",
      context: ActionContext.CORE,
      execute: async () => {
        logService.info("Executing built-in action: Reset Search Index");
        await searchService.resetIndex();
      },
    });
  }

  /**
   * Update the reactive state with currently relevant actions based on context
   */
  private updateState() {
    this.filteredActions = this.getFilteredActions();
  }
}

export const actionService = ActionService.getInstance();

// Backward compatibility for actionStore
export const actionStore = {
  get subscribe() {
    return (fn: (v: ApplicationAction[]) => void) => {
      fn(actionService.filteredActions);
      return () => {};
    };
  }
};
