export { ExtensionBridge } from "./ExtensionBridge";
export { ExtensionContext } from "./ExtensionContext";

// UI components proxying removed

export type {
  IExtensionManager,
  ILogService,
  INotificationService,
  IClipboardHistoryService,
  ICommandService,
  IStatusBarService,
  IStatusBarItem
} from './services';

export {
  // TODO: Tech Debt - Remove this public export once create-extension built-in is refactored 
  // to call host services directly instead of using this Tier 2 postMessage proxy.
  ExtensionManagerProxy,
  StatusBarServiceProxy,
} from './services';

// Export specific enums/types if needed individually
export { ActionContext, ActionCategory } from './types/ActionType';
export type { ActionCategoryValue } from './types/ActionType';

// Re-export all types for easier consumption
export * from './types';
