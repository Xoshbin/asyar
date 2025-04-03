/**
 * Available contexts for actions
 */
export enum ActionContext {
  /**
   * Action available globally
   */
  GLOBAL = "global",

  /**
   * Action available only within extension views
   */
  EXTENSION_VIEW = "extension_view",

  /**
   * Action available in search results context
   */
  SEARCH_VIEW = "search_view",

  /**
   * Action available in result display context
   */
  RESULT = "result",

  /**
   * Action available in the core application
   */
  CORE = "core",

  /**
   * Action available for a specific command result
   */
  COMMAND_RESULT = "command_result",
}

export interface ExtensionAction {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  extensionId: string;
  category?: string;
  context?: ActionContext; // Add the context property with the enum type
  execute: () => Promise<void> | void;
}

export interface IActionService {
  registerAction(action: ExtensionAction): void;
  unregisterAction(actionId: string): void;
  getActions(context?: ActionContext): ExtensionAction[]; // Add context parameter
  executeAction(actionId: string): Promise<void>;
  // Allow passing optional data (like commandId) when setting context
  setContext(context: ActionContext, data?: { commandId?: string }): void;
  getContext(): ActionContext; // Return the enum type
}
