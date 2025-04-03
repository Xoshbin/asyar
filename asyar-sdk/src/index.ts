export { ExtensionBridge } from "./ExtensionBridge";
export { ExtensionContext } from "./ExtensionContext";

// Export UI components
export * from "./components";

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
} from "./types";
export {
  IExtensionManager,
  ILogService,
  INotificationService,
  IClipboardHistoryService,
  ICommandService,
} from './services';

// Export specific enums/types if needed individually
export { ActionContext } from './types/ActionType';

// Re-export all types for easier consumption
export * from './types';
