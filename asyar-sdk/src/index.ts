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
  ExtensionManagerProxy,
} from './services';

// Export specific enums/types if needed individually
export { ActionContext } from './types/ActionType';

// Re-export all types for easier consumption
export * from './types';
