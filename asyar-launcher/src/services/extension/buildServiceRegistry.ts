import { defineServiceRegistry, type ServiceRegistry } from './defineServiceRegistry';
import type { IExtensionManager } from 'asyar-sdk';
import type { ExtendedManifest } from '../../types/ExtendedManifest';
import { logService } from '../log/logService';
import { settingsService } from '../settings/settingsService.svelte';
import { NotificationService } from '../notification/notificationService';
import { ClipboardHistoryService } from '../clipboard/clipboardHistoryService';
import { commandService } from './commandService.svelte';
import { actionService } from '../action/actionService.svelte';
import { statusBarService } from '../statusBar/statusBarService.svelte';
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
import { OpenerService } from '../opener/openerService';
import { NetworkService } from '../network/networkService';

export function buildServiceRegistry(deps: {
  extensionManager: IExtensionManager;
  getManifestById: (id: string) => ExtendedManifest | undefined;
  handleCommandAction: (objectId: string, args?: Record<string, unknown>) => Promise<unknown>;
}): ServiceRegistry {
  return defineServiceRegistry({
    log: logService,
    extensions: deps.extensionManager,
    notifications: new NotificationService(),
    clipboard: ClipboardHistoryService.getInstance(),
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
    opener: new OpenerService(),
    network: new NetworkService(),
  });
}
