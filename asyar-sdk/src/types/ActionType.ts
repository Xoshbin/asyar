/**
 * Available contexts for actions
 */
export enum ActionContext {
  /**
   * Action available globally
   */
  GLOBAL = 'global',

  /**
   * Action available only within extension views
   */
  EXTENSION_VIEW = 'extension_view',

  /**
   * Action available in search results context
   */
  SEARCH_VIEW = 'search_view',

  /**
   * Action available in result display context
   */
  RESULT = 'result',

  /**
   * Action available in the core application
   */
  CORE = 'core',

  /**
   * Action available for a specific command result
   */
  COMMAND_RESULT = 'command_result',
}

export interface ExtensionAction {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  extensionId: string;
  category?: string;
  context?: ActionContext; // Add the context property with the enum type
  execute: (payload?: unknown) => Promise<void> | void;
  confirm?: boolean;
  /**
   * Keyboard shortcut that both shows the hint and runs the action while it is
   * visible, including while the extension's view has focus. Canonical form
   * `Mod[+Alt][+Shift]+Key` (`Mod` = ⌘ on macOS, Ctrl elsewhere) or a bare
   * `F1`–`F24`. An invalid or reserved chord, or one on a `destructive` action,
   * is ignored (the action still registers) and the launcher logs a warning.
   */
  shortcut?: string;
  /** Renders in the launcher's danger color. Independent of `confirm`. */
  destructive?: boolean;
}

export interface IActionService {
  registerAction(action: ExtensionAction): void;
  unregisterAction(actionId: string): void;
  getActions(context?: ActionContext): ExtensionAction[]; // Add context parameter
  executeAction(actionId: string): Promise<void>;
  // Allow passing optional data (like extensionId or commandId) when setting context
  setContext(context: ActionContext, data?: { commandId?: string } | string): void;
  getContext(): ActionContext; // Return the enum type
  /** Register a handler for a notification action or search-result action. Local-only — no IPC. */
  registerActionHandler(
    actionId: string,
    handler: (payload?: unknown) => Promise<void> | void,
  ): void;
}

/**
 * Standard action category names.
 * Use these for consistent grouping in the ⌘K panel.
 * You may also use any custom string — these are recommendations, not restrictions.
 */
export const ActionCategory = {
  PRIMARY: 'Primary',
  NAVIGATION: 'Navigation',
  EDIT: 'Edit',
  SHARE: 'Share',
  DESTRUCTIVE: 'Destructive',
  SYSTEM: 'System',
} as const;

export type ActionCategoryValue = (typeof ActionCategory)[keyof typeof ActionCategory];
