export { ExtensionBridge } from "./ExtensionBridge";
export { ExtensionContext } from "./ExtensionContext";

// UI components proxying removed
export {
  Extension,
  ExtensionCommand,
  ExtensionManifest,
  ExtensionResult,
  NotificationActionType,
  NotificationChannel,
  NotificationOptions,
  ClipboardItemType,
  ClipboardHistoryItem,
  CommandHandler,
  CommandMatch,
  IActionService,
  ExtensionAction,
  INetworkService,
  NetworkResponse,
  RequestOptions,
} from "./types";
export {
  IExtensionManager,
  ILogService,
  INotificationService,
  IClipboardHistoryService,
  ICommandService,
  // TODO: Tech Debt - Remove this public export once create-extension built-in is refactored 
  // to call host services directly instead of using this Tier 2 postMessage proxy.
  ExtensionManagerProxy,
  StatusBarServiceProxy,
} from './services';
export type { IStatusBarService, IStatusBarItem } from './services';

// Export specific enums/types if needed individually
export { ActionContext, ActionCategory } from './types/ActionType';
export type { ActionCategoryValue } from './types/ActionType';

// Re-export all types for easier consumption
export * from './types';
