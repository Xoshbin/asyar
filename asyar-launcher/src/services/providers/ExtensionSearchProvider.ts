import { get } from "svelte/store";
import { logService } from "../logService";
import type { ISearchProvider } from "../interfaces/ISearchService";
import type {
  Extension,
  ExtensionCommand,
  ExtensionManifest,
  ExtensionResult,
} from "asyar-api";
import { extensionUsageStats, extensionLastUsed } from "../extensionManager";
import {
  performFuzzySearch,
  DEFAULT_FUSE_OPTIONS,
} from "../../utils/fuzzySearchUtils";

/**
 * Search provider for extension commands and functionality
 */
export class ExtensionSearchProvider implements ISearchProvider {
  id = "extension-provider";
  priority = 100; // High priority since extensions are core functionality

  private extensions: Extension[] = [];
  private manifests: Map<string, ExtensionManifest> = new Map();
  private extensionManifestMap: Map<Extension, ExtensionManifest> = new Map();
  private commandMap: Map<string, ExtensionCommand> = new Map();
  private extensionItems: any[] = []; // Cache for fuzzy search

  /**
   * Set extensions data for searching
   */
  setExtensionData(
    extensions: Extension[],
    manifests: Map<string, ExtensionManifest>,
    extensionManifestMap: Map<Extension, ExtensionManifest>,
    commandMap: Map<string, ExtensionCommand>
  ): void {
    this.extensions = extensions;
    this.manifests = manifests;
    this.extensionManifestMap = extensionManifestMap;
    this.commandMap = commandMap;

    // Prepare searchable extension items for fuzzy search
    this.prepareExtensionItems();
  }

  /**
   * Prepare extension items for fuzzy search
   */
  private prepareExtensionItems(): void {
    this.extensionItems = [];

    // Create searchable items from extensions
    for (const extension of this.extensions) {
      const manifest = this.extensionManifestMap.get(extension);
      if (!manifest) continue;

      // Add the extension itself as a searchable item
      this.extensionItems.push({
        title: manifest.name,
        subtitle: manifest.description || "",
        keywords: manifest.commands?.map((cmd) => cmd.trigger).join(" ") || "",
        extensionId: manifest.id,
        type: manifest.type,
        _extension: extension, // Keep reference to the extension object
        _manifest: manifest, // Keep reference to the manifest
      });

      // Add each command as a searchable item
      if (manifest.commands) {
        for (const cmd of manifest.commands) {
          this.extensionItems.push({
            title: cmd.name,
            subtitle: cmd.description || "",
            keywords: cmd.trigger,
            commandId: cmd.id,
            extensionId: manifest.id,
            type: "command",
            _extension: extension,
            _command: cmd,
          });
        }
      }
    }

    logService.debug(
      `Prepared ${this.extensionItems.length} extension items for fuzzy search`
    );
  }

  /**
   * Search through extensions
   */
  async search(query: string): Promise<ExtensionResult[]> {
    if (this.extensions.length === 0) return [];

    const results: ExtensionResult[] = [];
    const lowercaseQuery = query.toLowerCase();

    // First check for direct command matches (prefix matching for command triggers)
    const commandMatch = this.findCommandMatch(lowercaseQuery);
    if (commandMatch) {
      const [extensionId, commandId, args] = commandMatch;
      const commandResults = await this.executeCommandMatch(
        extensionId,
        commandId,
        args
      );
      results.push(...commandResults);
    }

    // Always do fuzzy search, but with adjusted parameters for short queries
    // Remove the check: if (query.length < 2 && !commandMatch) { return results; }

    // For all queries, including single-character ones, use fuzzy search
    // Use stricter threshold for single characters to avoid too many results
    const options = {
      ...DEFAULT_FUSE_OPTIONS,
      keys: [
        { name: "title", weight: 2 },
        { name: "keywords", weight: 1.5 },
        { name: "subtitle", weight: 0.7 },
      ],
      // Use a stricter threshold for short queries
      threshold: query.length === 1 ? 0.2 : 0.4,
      // For single characters, focus on the beginning of strings
      location: query.length === 1 ? 0 : 0,
      distance: query.length === 1 ? 10 : 100,
    };

    const fuzzyResults = performFuzzySearch(
      this.extensionItems,
      query,
      options
    );

    // Process fuzzy search results
    // Skip results with very low scores, use higher threshold for single characters
    const minScore = query.length === 1 ? 60 : 30;

    for (const item of fuzzyResults) {
      // Skip low-scoring results
      if (item.score < minScore) continue;

      // For regular extension items (not commands)
      if (item.type !== "command") {
        const extension = item._extension;
        const manifest = item._manifest;

        if (extension && manifest && typeof extension.search === "function") {
          try {
            // Add extra extension info
            const extensionResults = await extension.search(query);

            // Add scores and extension IDs to results
            const enhancedResults = extensionResults.map((result) => ({
              ...result,
              extensionId: manifest.id,
              // For extension search results, keep their original score if high,
              // otherwise boost by the fuzzy match score
              score: Math.max(result.score || 0, item.score),
            }));

            results.push(...enhancedResults);
          } catch (error) {
            logService.error(
              `Error during extension search for ${manifest.id}: ${error}`
            );
          }
        }
      }
      // For command items
      else {
        const extension = item._extension;
        const commandId = item.commandId;

        if (extension && commandId) {
          // Add a result for executing this command
          const cmd = this.commandMap.get(`${item.extensionId}.${commandId}`);
          if (cmd) {
            results.push({
              score: item.score,
              title: `Execute: ${cmd.name}`,
              subtitle: cmd.description || "",
              type: "result",
              extensionId: item.extensionId,
              action: async () => {
                try {
                  const args = { input: query };
                  await extension.executeCommand(commandId, args);
                } catch (error) {
                  logService.error(
                    `Error executing command ${commandId}: ${error}`
                  );
                }
              },
            });
          }
        }
      }
    }

    // Call search on extensions that match the query (the original search functionality)
    const directSearchPromises: Promise<ExtensionResult[]>[] = [];
    for (const extension of this.extensions) {
      const manifest = this.extensionManifestMap.get(extension);

      // Only directly call search if the manifest matches or it's a priority extension
      if (
        manifest &&
        (this.isHighPriorityExtension(manifest.id) ||
          this.extensionMatchesQuery(manifest, lowercaseQuery)) &&
        extension.search
      ) {
        directSearchPromises.push(extension.search(query));
      }
    }

    // Wait for all direct extension searches to complete
    if (directSearchPromises.length > 0) {
      const directResults = await Promise.all(directSearchPromises);
      directResults.forEach((resultSet) => {
        // Add each result ensuring we have extensionId
        resultSet.forEach((result) => {
          if (
            !results.some(
              (r) => r.title === result.title && r.subtitle === result.subtitle
            )
          ) {
            results.push({
              ...result,
              extensionId: (result as any).extensionId || null,
            });
          }
        });
      });
    }

    return results;
  }

  /**
   * Check if an extension should always run its search method
   */
  private isHighPriorityExtension(extensionId: string): boolean {
    // List of extensions that should always be searched
    // This could be made configurable
    const priorityExtensions = ["calculator", "appLauncher", "snippets"];
    return priorityExtensions.includes(extensionId);
  }

  /**
   * Execute a command match and return results
   */
  private async executeCommandMatch(
    extensionId: string,
    commandId: string,
    args: any
  ): Promise<ExtensionResult[]> {
    const results: ExtensionResult[] = [];

    try {
      // Find the extension that owns this command
      const extension = this.extensions.find(
        (ext) => this.extensionManifestMap.get(ext)?.id === extensionId
      );

      if (extension && extension.executeCommand) {
        // Update usage statistics
        extensionUsageStats.update((stats) => {
          stats[extensionId] = (stats[extensionId] || 0) + 1;
          return stats;
        });

        // Get command definition
        const cmd = this.commandMap.get(`${extensionId}.${commandId}`);

        if (cmd) {
          // Handle command match (same as in original extension manager)
          const manifest =
            this.manifests.get(extensionId) ||
            Array.from(this.manifests.values()).find(
              (m) => m.id === extensionId
            );

          const commandDef = manifest?.commands.find((c) => c.id === commandId);
          const isInlineResult = commandDef?.resultType === "inline";

          if (isInlineResult) {
            // For inline results, execute immediately
            try {
              const commandResult = await extension.executeCommand(
                commandId,
                args
              );

              if (commandResult) {
                const title =
                  commandResult.displayTitle ||
                  commandResult.formatted ||
                  (commandResult.result !== undefined
                    ? `${commandResult.expression || ""} = ${
                        commandResult.result
                      }`
                    : String(commandResult.title || ""));

                const subtitle =
                  commandResult.displaySubtitle ||
                  commandResult.description ||
                  cmd.description;

                results.push({
                  score: 100,
                  title,
                  subtitle,
                  type: "result",
                  extensionId,
                  action: () => {
                    try {
                      extension.executeCommand(
                        `${commandId}-action`,
                        commandResult
                      );
                    } catch (error) {
                      logService.error(
                        `Error executing action for ${commandId}: ${error}`
                      );
                    }
                  },
                });
              }
            } catch (error) {
              logService.error(
                `Error executing inline command ${commandId}: ${error}`
              );
            }
          } else {
            // For regular commands
            results.push({
              score: 100,
              title: `Execute: ${cmd.name}`,
              subtitle: cmd.description,
              type: "result",
              extensionId,
              action: async () => {
                try {
                  await extension.executeCommand(commandId, args);
                } catch (error) {
                  logService.error(
                    `Error executing command ${commandId}: ${error}`
                  );
                }
              },
            });
          }
        }
      }
    } catch (error) {
      logService.error(`Error processing command match: ${error}`);
    }

    return results;
  }

  /**
   * Get default results for popular and recently used extensions
   */
  async getDefaultResults(): Promise<ExtensionResult[]> {
    const results: ExtensionResult[] = [];
    const stats = get(extensionUsageStats);
    const lastUsed = get(extensionLastUsed);

    // Calculate a combined score for each extension:
    // - Usage count
    // - Recent usage (used in last 24 hours)
    // - Type (prefer 'view' type extensions for default results)
    const scoredExtensions = [];

    // Process all extensions with usage data
    for (const [extId, usageCount] of Object.entries(stats)) {
      // Skip view-specific stats (containing :)
      if (extId.includes(":")) continue;

      const extension = this.extensions.find(
        (ext) => this.extensionManifestMap.get(ext)?.id === extId
      );
      const manifest = extension
        ? this.extensionManifestMap.get(extension)
        : null;

      if (manifest) {
        // Calculate a meaningful score for sorting
        const lastUsedTime = lastUsed[extId] || 0;
        const recencyBoost = Date.now() - lastUsedTime < 86400000 ? 10 : 0;
        const typeBoost = manifest.type === "view" ? 5 : 0;
        const finalScore = usageCount * 3 + recencyBoost + typeBoost;

        scoredExtensions.push({
          extId,
          usageCount,
          manifest,
          extension,
          lastUsedTime,
          recentlyUsed: recencyBoost > 0,
          score: finalScore,
        });
      }
    }

    // Sort by combined score
    scoredExtensions.sort((a, b) => b.score - a.score);

    // Take top most-used extensions
    const topUsedExtensions = scoredExtensions.slice(0, 4);

    // Add recently used extensions that might not be in top usage
    const recentlyUsedExtensions = scoredExtensions
      .filter((ext) => ext.recentlyUsed)
      .sort((a, b) => b.lastUsedTime - a.lastUsedTime)
      .slice(0, 3);

    // Combine lists (unique by extension ID)
    const combinedExtensions = [...topUsedExtensions];
    for (const ext of recentlyUsedExtensions) {
      if (!combinedExtensions.some((e) => e.extId === ext.extId)) {
        combinedExtensions.push(ext);
      }
    }

    // Convert to results (limit to 6 total)
    for (const ext of combinedExtensions.slice(0, 6)) {
      const manifest = ext.manifest;
      const extension = ext.extension;

      // Calculate display score based on usage and recency
      const usageBoost = Math.min(40, Math.log2(ext.usageCount + 1) * 10);
      const recencyBoost = ext.recentlyUsed ? 10 : 0;
      const displayScore = 60 + usageBoost + recencyBoost;

      results.push({
        score: displayScore,
        title: manifest.name,
        subtitle: ext.recentlyUsed
          ? `${manifest.description || "Extension"} • Recently used`
          : manifest.description || "Extension",
        type: manifest.type,
        extensionId: manifest.id,
        icon: manifest.icon || "🧩",
        usageCount: ext.usageCount,
        recentlyUsed: ext.recentlyUsed,
        action: () => {
          if (manifest.type === "view") {
            // Navigate to the view
            (window as any).extensionManager?.navigateToView(
              `${manifest.id}/${manifest.defaultView}`
            );
          }
        },
      });
    }

    return results;
  }

  /**
   * Find a matching command from the query
   */
  private findCommandMatch(query: string): [string, string, any] | null {
    // Only perform standard prefix matching
    for (const [fullCommandId, command] of this.commandMap.entries()) {
      const triggerWord = command.trigger.toLowerCase();

      if (query.toLowerCase().startsWith(triggerWord)) {
        // Extract extension and command IDs
        const [extensionId, commandId] = fullCommandId.split(".");

        // Extract arguments
        const args = query.substring(triggerWord.length).trim();

        return [extensionId, commandId, { input: args }];
      }
    }

    return null;
  }

  /**
   * Check if extension matches the query
   */
  private extensionMatchesQuery(
    manifest: ExtensionManifest,
    query: string
  ): boolean {
    return manifest.commands.some((cmd) => {
      return query.startsWith(cmd.trigger.split(" ")[0].toLowerCase());
    });
  }
}
