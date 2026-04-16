import { listen } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import { isBuiltInFeature } from './extensionDiscovery';
import { extensionIframeManager } from './extensionIframeManager.svelte';
import type { ExtensionManifest } from 'asyar-sdk';

interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
  main?: string;
}

interface EventSubscriptionDeps {
  isExtensionEnabled: (id: string) => boolean;
  executeCommand: (objectId: string, args?: Record<string, unknown>) => Promise<unknown>;
  reloadExtensions: () => Promise<void>;
  getManifestById: (id: string) => ExtendedManifest | undefined;
}

export class ExtensionEventSubscriptions {
  private unlistenScheduler: (() => void) | null = null;
  private unlistenPreferencesChanged: (() => void) | null = null;

  async subscribe(deps: EventSubscriptionDeps): Promise<void> {
    this.unlistenScheduler = await listen<{ extensionId: string; commandId: string }>(
      'asyar:scheduler:tick',
      async (event) => {
        await this.handleScheduledTick(
          event.payload.extensionId,
          event.payload.commandId,
          deps.isExtensionEnabled,
          deps.executeCommand,
        );
      },
    );

    this.unlistenPreferencesChanged = await listen<{ extensionId: string }>(
      'asyar:preferences-changed',
      async (event) => {
        const extensionId = event.payload?.extensionId;
        if (!extensionId) return;

        const { extensionPreferencesService } = await import(
          './extensionPreferencesService.svelte'
        );
        extensionPreferencesService.invalidateCache(extensionId);

        try {
          await this.handlePreferencesChanged(
            extensionId,
            deps.getManifestById,
            deps.reloadExtensions,
          );
        } catch (err) {
          logService.error(
            `Failed to reload extension ${extensionId} after preferences change: ${err}`,
          );
        }
      },
    );
  }

  unsubscribe(): void {
    this.unlistenScheduler?.();
    this.unlistenScheduler = null;
    this.unlistenPreferencesChanged?.();
    this.unlistenPreferencesChanged = null;
  }

  private async handleScheduledTick(
    extensionId: string,
    commandId: string,
    isExtensionEnabled: (id: string) => boolean,
    executeCommand: (objectId: string, args?: Record<string, unknown>) => Promise<unknown>,
  ): Promise<void> {
    if (!isExtensionEnabled(extensionId)) return;

    const objectId = `cmd_${extensionId}_${commandId}`;
    logService.debug(`[Scheduler] Executing scheduled command: ${objectId}`);

    try {
      await executeCommand(objectId, { scheduledTick: true });
    } catch (error) {
      logService.error(`[Scheduler] Failed to execute ${objectId}: ${error}`);
    }
  }

  private async handlePreferencesChanged(
    extensionId: string,
    getManifestById: (id: string) => ExtendedManifest | undefined,
    reloadExtensions: () => Promise<void>,
  ): Promise<void> {
    const manifest = getManifestById(extensionId);
    if (!manifest) return;

    const { extensionPreferencesService } = await import('./extensionPreferencesService.svelte');
    const bundle = await extensionPreferencesService.getEffectivePreferences(extensionId);

    if (isBuiltInFeature(extensionId)) {
      await reloadExtensions();
    } else {
      extensionIframeManager.sendPreferencesToExtension(extensionId, {
        extension: bundle.extension,
        commands: bundle.commands,
      });
    }
  }
}
