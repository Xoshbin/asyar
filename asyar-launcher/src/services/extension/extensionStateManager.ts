import { writable, type Writable } from "svelte/store";
import { settingsService } from "../settings/settingsService";
import { logService } from "../log/logService";
import { isBuiltInFeature } from "./extensionDiscovery";
import { extensionLoaderService } from "../extensionLoaderService";
import type { ExtensionManifest } from "asyar-sdk";
import { discoverExtensions, setExtensionEnabled } from "../../lib/ipc/commands";

// Local extension of the manifest type (matching extensionManager.ts)
interface ExtendedManifest extends ExtensionManifest {
  permissions?: string[];
  main?: string;
}

export class ExtensionStateManager {
  public extensionUninstallInProgress = writable<string | null>(null);
  public extensionUsageStats = writable<Record<string, number>>({});
  public extensionLastUsed = writable<Record<string, number>>({});

  private manifestsById: Map<string, ExtendedManifest> = new Map();
  private reloadExtensionsCallback: () => Promise<void> = async () => {};

  public init(
    manifestsById: Map<string, ExtendedManifest>,
    reloadExtensionsCallback: () => Promise<void>
  ) {
    this.manifestsById = manifestsById;
    this.reloadExtensionsCallback = reloadExtensionsCallback;
  }

  isExtensionEnabled(extensionId: string): boolean {
    if (isBuiltInFeature(extensionId)) {
      return true;
    }
    return settingsService.isExtensionEnabled(extensionId);
  }

  async toggleExtensionState(
    extensionId: string,
    enabled: boolean
  ): Promise<boolean> {
    if (isBuiltInFeature(extensionId) && !enabled) {
      logService.warn(`Cannot disable built-in feature: ${extensionId}`);
      return false;
    }

    try {
      await setExtensionEnabled(extensionId, enabled);
      
      logService.info(
        `Extension '${extensionId}' state set to ${
          enabled ? "enabled" : "disabled"
        }. Reloading extensions...`
      );
      await this.reloadExtensionsCallback();
      return true;
    } catch (error) {
      logService.error(
        `Failed to toggle extension state for '${extensionId}': ${error}`
      );
      return false;
    }
  }

  async getAllExtensionsWithState(): Promise<any[]> {
    try {
      const records = await discoverExtensions();
      const allExtensionsData: Array<any> = [];

      for (const record of records) {
        const manifest = record.manifest;
        allExtensionsData.push({
          title: manifest.name,
          subtitle: manifest.description || "",
          type: manifest.type || "unknown",
          keywords:
            manifest.commands
              ?.map((cmd: any) => cmd.trigger || cmd.name)
              .join(" ") || "",
          enabled: record.enabled,
          id: manifest.id,
          version: manifest.version || "N/A",
          isBuiltIn: record.isBuiltIn,
        });
      }
      allExtensionsData.sort((a, b) => {
        if (a.isBuiltIn && !b.isBuiltIn) return -1;
        if (!a.isBuiltIn && b.isBuiltIn) return 1;
        return a.title.localeCompare(b.title);
      });
      return allExtensionsData;
    } catch (error) {
      logService.error(`Error retrieving all extensions with state: ${error}`);
      return [];
    }
  }

  async getAllExtensions(navigateToView: (viewPath: string) => void): Promise<any[]> {
    const allItems: any[] = [];
    this.manifestsById.forEach((manifest) => {
      const isBuiltIn = isBuiltInFeature(manifest.id);
      if (isBuiltIn || this.isExtensionEnabled(manifest.id)) {
        allItems.push({
          title: manifest.name,
          subtitle: manifest.description,
          keywords:
            manifest.commands
              ?.map((cmd) => cmd.trigger || cmd.name)
              .join(" ") || "",
          type: manifest.type,
          action: () => {
            if (manifest.type === "view" && manifest.defaultView) {
              navigateToView(`${manifest.id}/${manifest.defaultView}`);
            } else {
              logService.info(
                `Default action triggered for non-view/commandless extension: ${manifest.id}`
              );
            }
          },
        });
      }
    });
    return allItems;
  }

  public recordViewUsage(extensionId: string): void {
    const manifest = this.manifestsById.get(extensionId);
    if (manifest && manifest.id) {
      logService.info(
        `Extension view opened for extension: ${manifest.id}`
      );
      const now = Date.now();
      this.extensionUsageStats.update((stats) => {
        const currentCount = stats[manifest.id!] || 0;
        return { ...stats, [manifest.id!]: currentCount + 1 };
      });
      this.extensionLastUsed.update((stats) => ({ ...stats, [manifest.id!]: now }));
    } else {
      logService.warn(
        `Could not find manifest for ID ${extensionId} while updating usage stats.`
      );
    }
  }
}

export const extensionStateManager = new ExtensionStateManager();
export const extensionUsageStats = extensionStateManager.extensionUsageStats;
export const extensionLastUsed = extensionStateManager.extensionLastUsed;
export const extensionUninstallInProgress = extensionStateManager.extensionUninstallInProgress;
