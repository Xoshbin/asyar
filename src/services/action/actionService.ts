import { writable, get } from "svelte/store";
import { logService } from "../log/logService";
import type { ExtensionAction, IActionService } from "asyar-api";
import { ActionContext } from "asyar-api";
import { invoke } from "@tauri-apps/api/core";
import { searchService } from "../search/SearchService";
import { commandRegistry } from "../extension/commandService";

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
  execute: () => Promise<void> | void;
}

// Create a store for actions filtered by the current context
export const actionStore = writable<ApplicationAction[]>([]);

/**
 * ActionService implementation for the main application
 * Connects extension actions to the application UI
 */
export class ActionService implements IActionService {
  private static instance: ActionService;
  private allActions: Map<string, ApplicationAction> = new Map();
  private currentContext: ActionContext = ActionContext.CORE;

  private constructor() {
    this.registerBuiltInActions();
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
      this.updateStore(); // Update the Svelte store with filtered actions
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
      execute: action.execute,
      disabled: "disabled" in action ? action.disabled : undefined,
    };

    this.allActions.set(appAction.id, appAction); // Store in the master list
    logService.debug(
      `Registered action: ${appAction.id} from ${
        appAction.extensionId || "core"
      }, context: ${appAction.context || "default"}`
    );

    // Update the store if the action matches the current context
    this.updateStore();
  }

  /**
   * Unregister an action
   */
  unregisterAction(actionId: string): void {
    if (this.allActions.delete(actionId)) {
      logService.debug(`Unregistered action: ${actionId}`);
      // Update the store
      this.updateStore();
    } else {
      logService.warn(
        `Attempted to unregister non-existent action: ${actionId}`
      );
    }
  }

  /**
   * Get all registered actions (primarily for internal use or debugging)
   * Note: This returns ALL actions, not filtered by context. Use the actionStore for UI.
   */
  getAllActions(): ApplicationAction[] {
    return Array.from(this.allActions.values());
  }

  /**
   * Get actions filtered by the current context (used by updateStore)
   */
  private getFilteredActions(): ApplicationAction[] {
    const filtered = Array.from(this.allActions.values()).filter(
      this.filterActionsByContext.bind(this)
    );

    // Log details about filtered actions
    logService.debug(
      `Filtering actions for context: ${this.currentContext}. Found ${filtered.length} actions.`
    );
    // filtered.forEach(action => { // Keep logging if useful
    //   logService.debug(`  - Filtered Action: ${action.id} (Context: ${action.context}, Ext: ${action.extensionId || 'core'})`);
    // });

    return filtered;
  }

  /**
   * Get actions based on a specific context (implements IActionService method)
   * Note: This might not be ideal if commandId is needed for COMMAND_RESULT.
   * Consider if this method is still necessary or if actionStore is sufficient.
   */
  getActions(context?: ActionContext): ExtensionAction[] {
    const targetContext = context || this.currentContext;
    // WARNING: This implementation won't correctly filter COMMAND_RESULT actions
    // if called externally without the commandId context being set internally first.
    // It's generally better to rely on the actionStore which uses getFilteredActions.
    if (targetContext === ActionContext.COMMAND_RESULT) {
      logService.warn(
        "getActions(COMMAND_RESULT) called directly; may not return correct results. Prefer using the actionStore after setting context with commandId."
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
      // logService.debug(`Filtering action ${action.id}: Matched GLOBAL action in ${this.currentContext} context.`);
      return true;
    }

    // Fallback: If context is CORE, show CORE actions only if no context-specific (non-GLOBAL) actions are available
    // This prevents CORE actions from cluttering the view when specific extension/command actions should take precedence.
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
      const shouldShowCore = specificActionCount === 0;
      // logService.debug(`Filtering action ${action.id}: CORE context, CORE action. Specific count: ${specificActionCount}. Show: ${shouldShowCore}`);
      return shouldShowCore; // Show CORE only if no other specific actions exist for CORE context
    }

    // logService.debug(`Filtering action ${action.id}: Did not match any context rule.`);
    return false; // Action doesn't match current context rules
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
    this.registerAction({
      // Use registerAction for consistency
      id: "settings",
      label: "Settings",
      icon: "⚙️", // Consider using a consistent icon system if available
      description: "Configure application settings",
      context: ActionContext.CORE, // Explicitly CORE context
      execute: async () => {
        // Logic to open settings window/view
        logService.info("Executing built-in action: Open Settings");
        try {
          // Example: Assuming 'settings' is the label of the settings window
          await invoke("plugin:window|show", { label: "settings" });
        } catch (err) {
          logService.error(`Failed to open settings window: ${err}`);
        }
      },
    });

    // Reset Search Index action
    this.registerAction({
      // Use registerAction for consistency
      id: "reset_search",
      label: "Reset Search Index",
      icon: "🔄", // Example icon
      description: "Reset the search index",
      context: ActionContext.CORE,
      execute: async () => {
        logService.info("Executing built-in action: Reset Search Index");
        await searchService.resetIndex();
      },
    });

    // Note: updateStore is called implicitly by registerAction
  }

  /**
   * Update the action store with currently relevant actions based on context
   */
  private updateStore() {
    const filteredActions = this.getFilteredActions();
    actionStore.set(filteredActions);
  }
}

export const actionService = ActionService.getInstance();
