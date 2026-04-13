import { listen } from '@tauri-apps/api/event';
import { logService } from '../log/logService';
import type { ExtensionManifest, ExtensionCommand } from 'asyar-sdk';

export interface DeeplinkDeps {
  getManifestById: (id: string) => ExtensionManifest | undefined;
  isExtensionEnabled: (id: string) => boolean;
  hasCommand: (objectId: string) => boolean;
  executeCommand: (objectId: string, args?: Record<string, any>) => Promise<any>;
  navigateToView: (viewPath: string) => void;
  showWindow: () => Promise<void>;
  recordItemUsage: (objectId: string) => Promise<void>;
}

interface ExtensionDeeplinkPayload {
  extensionId: string;
  commandId: string;
  args: Record<string, string>;
}

export class DeeplinkService {
  constructor(private deps: DeeplinkDeps) {}

  /** Register the permanent Tauri event listener. Call once at app init. */
  async init(): Promise<void> {
    await listen<ExtensionDeeplinkPayload>('asyar:deeplink:extension', (event) => {
      this.handleExtensionDeeplink(event.payload);
    });
  }

  /** Validate and dispatch an extension deep link. Errors are logged, never thrown. */
  async handleExtensionDeeplink(payload: ExtensionDeeplinkPayload): Promise<void> {
    const { extensionId, commandId, args } = payload;
    const objectId = `cmd_${extensionId}_${commandId}`;

    try {
      // 1. Extension must exist
      const manifest = this.deps.getManifestById(extensionId);
      if (!manifest) {
        logService.error(`[Deeplink] Extension not found: ${extensionId}`);
        return;
      }

      // 2. Extension must be enabled
      if (!this.deps.isExtensionEnabled(extensionId)) {
        logService.error(`[Deeplink] Extension is disabled: ${extensionId}`);
        return;
      }

      // 3. Command must exist in manifest
      const command = manifest.commands.find((c: ExtensionCommand) => c.id === commandId);
      if (!command) {
        logService.error(`[Deeplink] Command '${commandId}' not found in extension '${extensionId}'`);
        return;
      }

      // 4. Command must be registered in commandService
      if (!this.deps.hasCommand(objectId)) {
        logService.error(`[Deeplink] Command '${objectId}' not registered`);
        return;
      }

      // 6. Determine execution mode based on resultType
      const isView = command.resultType === 'view' || manifest.type === 'view';

      if (isView) {
        await this.deps.showWindow();
        const viewPath = `${extensionId}/${manifest.defaultView || commandId}`;
        this.deps.navigateToView(viewPath);
      }

      // 7. Execute with deeplinkTrigger flag (bypasses preference gate)
      await this.deps.executeCommand(objectId, { ...args, deeplinkTrigger: true });

      // 8. Record usage
      this.deps.recordItemUsage(objectId).catch((err) =>
        logService.error(`[Deeplink] Failed to record usage for ${objectId}: ${err}`)
      );

    } catch (error) {
      logService.error(`[Deeplink] Failed to execute ${objectId}: ${error}`);
    }
  }
}

export function createDeeplinkService(deps: DeeplinkDeps): DeeplinkService {
  return new DeeplinkService(deps);
}
