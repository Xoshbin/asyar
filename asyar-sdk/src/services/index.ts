export * from "./LogService";
export * from "./INotificationService";
export * from "./IClipboardHistoryService";
export * from "./IExtensionManager";
export * from "./ICommandService";
export * from "./ISettingsService";

export * from "./BaseServiceProxy";
export * from "./LogServiceProxy";
export * from "./NotificationServiceProxy";
export * from "./ClipboardHistoryServiceProxy";
export * from "./ExtensionManagerProxy";
export { CommandServiceProxy } from './CommandServiceProxy';
export { ActionServiceProxy } from './ActionServiceProxy';
export { NetworkServiceProxy } from './NetworkServiceProxy';
export { SettingsServiceProxy } from './SettingsServiceProxy';
export { StatusBarServiceProxy } from './StatusBarServiceProxy';
export type { IStatusBarService, IStatusBarItem } from './IStatusBarService';

export type { IEntitlementService } from './IEntitlementService';
export { EntitlementServiceProxy } from './EntitlementServiceProxy';

export type { IStorageService } from './IStorageService';
export { StorageServiceProxy } from './StorageServiceProxy';

export type {
  IFeedbackService,
  ShowToastOptions,
  ConfirmAlertOptions,
  ToastStyle,
} from './IFeedbackService';
export { FeedbackServiceProxy } from './FeedbackServiceProxy';
export type { ISelectionService, SelectionError, SelectionErrorCode } from './ISelectionService';
export { SelectionServiceProxy } from './SelectionServiceProxy';

export * from './IAIService';
export { AIServiceProxy } from './AIServiceProxy';

export type { IOAuthService, OAuthConfig, OAuthToken, OAuthError } from './IOAuthService';
export { OAuthServiceProxy } from './OAuthServiceProxy';

export * from './IShellService';
export { ShellServiceProxy } from './ShellServiceProxy';

export type { IFileManagerService } from './IFileManagerService';
export { FileManagerServiceProxy } from './FileManagerServiceProxy';
