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

export { SearchBarAccessoryServiceProxy } from './SearchBarAccessoryServiceProxy';
export type { ISearchBarAccessoryService } from './ISearchBarAccessoryService';

export type { IEntitlementService } from './IEntitlementService';
export { EntitlementServiceProxy } from './EntitlementServiceProxy';

export type { IStorageService } from './IStorageService';
export { StorageServiceProxy } from './StorageServiceProxy';

export type { IPreferencesService, PreferenceValue } from './IPreferencesService';
export { PreferencesServiceProxy } from './PreferencesServiceProxy';

export type { ICacheService, CacheSetOptions } from './ICacheService';
export { CacheServiceProxy } from './CacheServiceProxy';

export type { ISearchService, RankableItem } from './ISearchService';
export { SearchServiceProxy } from './SearchServiceProxy';

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

export type { IInteropService } from './IInteropService';
export { LaunchCommandError } from './IInteropService';
export { InteropServiceProxy } from './InteropServiceProxy';
export type {
  IApplicationService,
  FrontmostApplication,
  AppPresenceEvent,
  AppPresenceEventKind,
  Disposer as AppPresenceDisposer,
} from './ApplicationService';
export { ApplicationServiceProxy } from './ApplicationService';
export type { IWindowManagementService, WindowBounds } from './WindowManagementService';
export { WindowManagementServiceProxy } from './WindowManagementService';

export type {
  IPowerService,
  KeepAwakeOptions,
  ResolvedKeepAwakeOptions,
  ActiveInhibitor,
} from './IPowerService';
export { PowerServiceProxy } from './PowerServiceProxy';

export type {
  IProcessService,
  ProcessSortBy,
  ProcessInfo,
  AppGroup,
  KillFailure,
  KillResult,
  ListProcessesOptions,
  KillProcessesOptions,
} from './IProcessService';
export { ProcessServiceProxy } from './ProcessServiceProxy';

export type {
  ISystemEventsService,
  SystemEvent,
  SystemEventKind,
  Disposer,
} from './ISystemEventsService';
export { SystemEventsServiceProxy } from './SystemEventsServiceProxy';

export type {
  ITimerService,
  TimerDescriptor,
  ScheduleTimerOptions,
} from './ITimerService';
export { TimerServiceProxy } from './TimerServiceProxy';

export type {
  IFileSystemWatcherService,
  FileSystemWatcherOptions,
  FileSystemChangeEvent,
  WatcherHandle,
} from './FileSystemWatcherService';
export { FileSystemWatcherServiceProxy } from './FileSystemWatcherService';

