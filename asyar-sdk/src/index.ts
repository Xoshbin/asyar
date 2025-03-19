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
  IActionService,
  ExtensionAction,
} from "./types";
export {
  IExtensionManager,
  ILogService,
  INotificationService,
  IClipboardHistoryService,
  ICommandService,
} from "./services";
