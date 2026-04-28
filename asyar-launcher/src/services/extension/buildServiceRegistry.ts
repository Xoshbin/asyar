import { defineServiceRegistry, type ServiceRegistry } from './defineServiceRegistry';
import type { IExtensionManager } from 'asyar-sdk/contracts';
import type { ExtendedManifest } from '../../types/ExtendedManifest';
import { logService } from '../log/logService';
import { settingsService } from '../settings/settingsService.svelte';
import { notificationService } from '../notification/notificationService';
import { clipboardHistoryService } from '../clipboard/clipboardHistoryService';
import { commandService } from './commandService.svelte';
import { actionService } from '../action/actionService.svelte';
import { statusBarService } from '../statusBar/statusBarService.svelte';
import { searchBarAccessoryService } from '../search/searchBarAccessoryService.svelte';
import type { SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
import { entitlementService } from '../auth/entitlementService.svelte';
import { extensionStorageService } from '../storage/extensionStorageService';
import { extensionPreferencesService } from './extensionPreferencesService.svelte';
import { extensionCacheService } from '../storage/extensionCacheService';
import { feedbackService } from '../feedback/feedbackService.svelte';
import { selectionService } from '../selection/selectionService';
import { aiExtensionService } from '../ai/aiService.svelte';
import { extensionOAuthService } from '../oauth/extensionOAuthService.svelte';
import { shellService } from '../shell/shellService.svelte';
import { fileManagerService } from '../fileManager/fileManagerService';
import { InteropService } from '../interop/interopService.svelte';
import { applicationService } from '../application/applicationService';
import { windowManagementService } from '../windowManagement/windowManagementService';
import { openerService } from '../opener/openerService';
import { networkService } from '../network/networkService';
import { powerService } from '../power/powerService';
import { systemEventsService } from '../systemEvents/systemEventsService';
import { appEventsService } from '../appEvents/appEventsService';
import { applicationIndexService } from '../applicationIndex/applicationIndexService';
import { timerService } from '../timers/timerService';
import { fsWatcherService } from '../fsWatcher/fsWatcherService';
import { extensionStateService } from '../extensionState/extensionStateService';
import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';

export function buildServiceRegistry(deps: {
  extensionManager: IExtensionManager;
  getManifestById: (id: string) => ExtendedManifest | undefined;
  handleCommandAction: (objectId: string, args?: Record<string, unknown>) => Promise<unknown>;
}): ServiceRegistry {
  return defineServiceRegistry({
    log: logService,
    extensions: deps.extensionManager,
    notifications: notificationService,
    clipboard: clipboardHistoryService,
    commands: commandService,
    actions: actionService,
    settings: {
      get: async (section: string, key: string) => {
        const settings = settingsService.getSettings();
        return (settings as any)[section]?.[key];
      },
      set: async (section: string, key: string, value: any) => {
        return settingsService.updateSettings(section as any, { [key]: value });
      },
    },
    statusBar: statusBarService,
    searchBar: {
      // The IPC dispatcher spreads payload values via `Object.values`. The
      // SDK proxy wraps `set` in a single-keyed envelope (`{ opts }`) so
      // the spread yields `[opts]` rather than `[options, value]` in
      // unstable key order — see ExtensionIpcRouter.dispatchApiCall.
      set: (
        extensionId: string,
        opts: { options?: SearchBarAccessoryDropdownOption[]; value?: string },
      ) => searchBarAccessoryService.set(extensionId, opts ?? {}),
      clear: (extensionId: string) =>
        searchBarAccessoryService.clearForExtension(extensionId),
    },
    entitlements: {
      check: (entitlement: string) => entitlementService.check(entitlement),
      getAll: () => entitlementService.getAll(),
    },
    storage: extensionStorageService,
    preferences: {
      getAll: (extensionId: string) =>
        extensionPreferencesService.getEffectivePreferences(extensionId),
      set: (extensionId: string, scope: string, key: string, value: unknown) =>
        extensionPreferencesService.set(
          extensionId,
          scope === 'extension' ? null : scope,
          key,
          value,
        ),
      reset: (extensionId: string, scope: string) =>
        extensionPreferencesService.reset(extensionId, scope),
    },
    cache: extensionCacheService,
    feedback: feedbackService,
    diagnostics: diagnosticsService,
    selection: selectionService,
    ai: aiExtensionService,
    oauth: extensionOAuthService,
    shell: shellService,
    fs: fileManagerService,
    interop: new InteropService({
      hasCommand: (objectId: string) => commandService.commands.has(objectId),
      getManifestById: (id: string) => deps.getManifestById(id),
      handleCommandAction: (objectId: string, args?: Record<string, unknown>) =>
        deps.handleCommandAction(objectId, args),
    }),
    application: applicationService,
    window: windowManagementService,
    opener: openerService,
    network: networkService,
    power: powerService,
    systemEvents: systemEventsService,
    appEvents: appEventsService,
    applicationIndex: applicationIndexService,
    timers: timerService,
    fsWatcher: fsWatcherService,
    state: extensionStateService,
  });
}
