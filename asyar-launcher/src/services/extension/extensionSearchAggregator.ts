import type { Extension, ExtensionResult, ExtensionManifest } from "asyar-sdk";
import { logService } from "../log/logService";
import { extensionIframeManager } from './extensionIframeManager.svelte';
import { settingsService } from "../settings/settingsService.svelte";

/**
 * Shape of a loaded extension module. Can be either a direct Extension instance
 * or an ES module wrapper where the extension is the default export.
 */
type LoadedExtensionModule = Extension | { default: Extension };

export class ExtensionSearchAggregator {
  private extensionModulesById: Map<string, LoadedExtensionModule> = new Map();
  private manifestsById: Map<string, ExtensionManifest> = new Map();
  private isExtensionEnabled: (id: string) => boolean = () => false;
  private navigateToView: (viewPath: string) => void = () => {};

  public init(
    extensionModulesById: Map<string, LoadedExtensionModule>,
    manifestsById: Map<string, ExtensionManifest>,
    isExtensionEnabled: (id: string) => boolean,
    navigateToView: (viewPath: string) => void
  ) {
    this.extensionModulesById = extensionModulesById;
    this.manifestsById = manifestsById;
    this.isExtensionEnabled = isExtensionEnabled;
    this.navigateToView = navigateToView;
  }

  /**
   * Resolve an extension instance from a loaded module. Handles both direct
   * Extension instances and ES modules where the extension is the default export.
   */
  public resolveExtensionInstance(module: LoadedExtensionModule): Extension {
    if (module && 'default' in module && module.default != null) {
      return module.default;
    }
    return module as Extension;
  }

  /**
   * Calls the search method on all enabled extensions and aggregates results.
   */
  async searchAll(query: string): Promise<ExtensionResult[]> {
    const allResults: ExtensionResult[] = [];
    const searchPromises: Promise<ExtensionResult[]>[] = [];

    logService.debug(
      `Calling search() on loaded extensions for query: "${query}"`
    );

    const settings = settingsService.getSettings();
    const enableExtensionSearch = settings.search.enableExtensionSearch;

    // Tier 1: Direct function calls (EXISTING)
    this.extensionModulesById.forEach((module, id) => {
      const extensionInstance = this.resolveExtensionInstance(module);
      if (
        this.isExtensionEnabled(id) &&
        extensionInstance &&
        typeof extensionInstance.search === "function"
      ) {
        searchPromises.push(
          Promise.resolve()
            .then(() => extensionInstance.search!(query))
            .then((results) => {
              return (results || []).map((res: ExtensionResult) => ({ ...res, extensionId: id }));
            })
            .catch((error) => {
              logService.error(`Error searching in extension ${id}: ${error}`);
              return [];
            })
        );
      }
    });

    // Tier 2: Send postMessage to searchable iframes (NEW)
    // Only include Tier 2 if the setting is enabled
    if (enableExtensionSearch) {
      this.manifestsById.forEach((manifest, id) => {
        // Tier 2 extensions (installed) have module: null in our loader,
        // but they are present in manifestsById.
        // Built-in extensions are in extensionModulesById.
        const isTier2 = !this.extensionModulesById.has(id) || this.extensionModulesById.get(id) === null;
        
        if (isTier2 && manifest.searchable && this.isExtensionEnabled(id)) {
          searchPromises.push(
            extensionIframeManager.sendSearchRequestToExtension(id, query)
              .then((results) => {
                return (results || []).map((r: any) => ({
                  ...r,
                  extensionId: id,
                  // Create a host-side action since functions can't be serialized
                  action: () => {
                    const viewPath = r.viewPath || `${id}/${manifest.defaultView || 'DefaultView'}`;
                    this.navigateToView(viewPath);
                  }
                }));
              })
              .catch((error) => {
                logService.error(`Error searching in Tier 2 extension ${id}: ${error}`);
                return [];
              })
          );
        }
      });
    }

    const SEARCH_TIMEOUT_MS = 200;

    const timeoutPromise = new Promise<'timeout'>(resolve => 
      setTimeout(() => resolve('timeout'), SEARCH_TIMEOUT_MS)
    );

    // Use Promise.allSettled so we get partial results
    const settled = await Promise.race([
      Promise.allSettled(searchPromises),
      timeoutPromise.then(() => 'timeout' as const)
    ]);

    if (settled === 'timeout') {
      // Timeout hit — collect whatever resolved so far
      const snapshots = await Promise.allSettled(
        searchPromises.map(p => Promise.race([p, Promise.resolve('pending' as const)]))
      );
      for (const snap of snapshots) {
        if (snap.status === 'fulfilled' && snap.value !== 'pending') {
          allResults.push(...(snap.value as ExtensionResult[]));
        }
      }
      logService.debug(
        `Extension search timed out after ${SEARCH_TIMEOUT_MS}ms. Returning ${allResults.length} partial results.`
      );
    } else {
      // All settled within timeout
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value);
        }
      }
      logService.debug(
        `Aggregated ${allResults.length} results from extension search mechanisms.`
      );
    }

    // Sort results by score (descending)
    allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return allResults;
  }
}

export const extensionSearchAggregator = new ExtensionSearchAggregator();

