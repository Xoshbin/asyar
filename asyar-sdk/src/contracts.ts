/**
 * asyar-sdk/contracts — neutral entry point.
 *
 * Launcher-safe. No role assertion, no top-level DOM requirement. This is
 * the surface consumed by:
 *   - Tier 1 launcher host code (outside any extension iframe).
 *   - Tier 1 built-in features under `asyar-launcher/src/built-in-features/`.
 *   - SDK-internal code that needs types + IPC primitives without
 *     asserting a specific iframe role.
 *
 * For Tier 2 extension code running inside a sandboxed iframe, import
 * from `asyar-sdk/worker` or `asyar-sdk/view` instead — those entries
 * assert `window.__ASYAR_ROLE__` at module-load time and project a
 * role-appropriate proxy surface.
 */

export { ExtensionBridge, extensionBridge } from "./ExtensionBridge";
export { ExtensionContext } from "./ExtensionContext";
export { ExtensionContextCore } from './ExtensionContextCore';
export type { ExtensionContextRole } from './ExtensionContextCore';

// IPC namespace single source of truth
export { NAMESPACES, isNamespace } from './ipc/namespaces';
export type { Namespace, WireCommand } from './ipc/namespaces';

export { MessageBroker, messageBroker } from './ipc/MessageBroker';
export type { HostDispatcher, IPCMessage, IPCResponse } from './ipc/MessageBroker';

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

export type { ISearchBarAccessoryService } from './services/ISearchBarAccessoryService';
export type {
  SearchBarAccessoryDropdownOption,
  SearchBarAccessoryManifestDeclaration,
  SearchBarAccessorySetOptions,
  SearchBarAccessoryListener,
} from './types/SearchBarAccessoryType';
export { SearchBarAccessoryServiceProxy } from './services/SearchBarAccessoryServiceProxy';

export type { Diagnostic, DiagnosticSource, IDiagnosticsService, Severity } from './contracts/diagnostics';
export type { Run, RunHandle, RunKind, RunStartInput, RunStatus, IRunService } from './contracts/runs';
export type { ManifestTool, ToolDescriptor, ToolFullyQualifiedId, ToolHandler, IToolsService } from './contracts/tools';
export { ToolsServiceProxy } from './services/ToolsServiceProxy';

export type { ShortcodeMap, ISnippetsService } from './contracts/snippets';
export { SHORTCODE_PATTERN, isValidShortcode } from './contracts/snippets';

export type {
  IBrowserService,
  BrowserFamily,
  BrowserId,
  Bookmark,
  HistoryEntry,
  ListBookmarksFilter,
  SearchHistoryOptions,
} from './services/IBrowserService';

// Launcher-brokered extension state store + RPC primitive.
// Re-exported so launcher-side wiring can reference them in type positions.
export { ExtensionStateProxy, extensionStateProxy } from './services/ExtensionStateProxy';
export { ExtensionRpc, extensionRpc } from './services/ExtensionRpc';

// Type-reference exports for Tier 1 launcher registry wiring.
export {
  ExtensionManagerProxy,
  StatusBarServiceProxy,
} from './services';

export { ActionContext, ActionCategory } from './types/ActionType';
export type { ActionCategoryValue } from './types/ActionType';

export { PreferencesFacade } from './PreferencesFacade';
export type { PreferencesSnapshot } from './PreferencesFacade';

export { injectThemeVariables, injectFontFaceCSS } from './lib/themeInjector';

export * from './types';
export * from './icons';
export * from './search';
