export { ExtensionBridge, extensionBridge } from "./ExtensionBridge";
export { ExtensionContext } from "./ExtensionContext";

// IPC namespace single source of truth
export { NAMESPACES, isNamespace } from './ipc/namespaces'
export type { Namespace, WireCommand } from './ipc/namespaces'

export { MessageBroker, messageBroker } from './ipc/MessageBroker'
export type { HostDispatcher, IPCMessage, IPCResponse } from './ipc/MessageBroker'

// UI components proxying removed

export type {
  IExtensionManager,
  ILogService,
  INotificationService,
  IClipboardHistoryService,
  ICommandService,
  IStatusBarService,
  IStatusBarItem,
  ISettingsService,
  IEntitlementService,
  IFeedbackService,
  ShowToastOptions,
  ConfirmAlertOptions,
  ToastStyle,
  ISelectionService,
  SelectionError,
  SelectionErrorCode,
  IStorageService,
  IPreferencesService,
  PreferenceValue,
  IAIService,
  AIStreamHandle,
  AIStreamHandlers,
  AIMessage,
  IOAuthService,
  OAuthConfig,
  OAuthToken,
  OAuthError,
  IShellService,
  IFileManagerService,
  IInteropService,
  IApplicationService,
  FrontmostApplication,
  AppPresenceEvent,
  AppPresenceEventKind,
  ICacheService,
  CacheSetOptions,
  IWindowManagementService,
  WindowBounds,
  ShellHandle,
  ShellChunk,
  SpawnParams,
  IPowerService,
  KeepAwakeOptions,
  ResolvedKeepAwakeOptions,
  ActiveInhibitor,
  ISystemEventsService,
  SystemEvent,
  SystemEventKind,
  Disposer,
  ITimerService,
  TimerDescriptor,
  ScheduleTimerOptions,
  IFileSystemWatcherService,
  FileSystemWatcherOptions,
  FileSystemChangeEvent,
  WatcherHandle,
} from './services';

export { FileSystemWatcherServiceProxy } from './services';

export { LaunchCommandError } from './services';

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
export * from './icons';
export * from './search';
