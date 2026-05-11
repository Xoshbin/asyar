import type { SearchResult } from '../services/search/interfaces/SearchResult';
import { logService } from '../services/log/logService';
import type { MappedSearchItem } from '../services/search/types/MappedSearchItem';
import type { ItemShortcut } from '../built-in-features/shortcuts/shortcutStore.svelte';
import type { ActiveContext } from '../services/context/contextModeService.svelte';
import { applicationService } from '../services/application/applicationsService';
import extensionManager from '../services/extension/extensionManager.svelte';
import { aliasStore } from '../built-in-features/aliases/aliasStore.svelte';
import type { Run } from 'asyar-sdk/contracts';
import { runService } from '../services/run/runService.svelte';
import { viewManager } from '../services/extension/viewManager.svelte';

export type ResolvedItemMeta = {
  objectId: string;
  icon: string;
  typeLabel: string | undefined;
};

/**
 * Resolves display metadata (icon, type label, objectId) for a raw SearchResult.
 * Pure function — no side effects, no service calls.
 */
export function resolveItemMeta(
  result: SearchResult,
  getManifestById: (extensionId: string) => { name: string } | undefined | null
): ResolvedItemMeta {
  const type = result.type || 'unknown';

  // --- Icon resolution ---
  let icon = result.icon ?? '🧩';
  if (!result.icon) {
    if (type === 'application') icon = '🖥️';
    else if (type === 'command') icon = '❯_';
  }

  // --- TypeLabel resolution ---
  let typeLabel: string | undefined = type
    ? type.charAt(0).toUpperCase() + type.slice(1)
    : undefined;
  if (type === 'command' && result.extensionId) {
    const manifest = getManifestById(result.extensionId);
    if (manifest?.name) {
      typeLabel = manifest.name;
    }
  }

  // --- ObjectId fallback ---
  const rawId = result.objectId;
  let objectId: string;
  if (typeof rawId === 'string' && rawId) {
    objectId = rawId;
  } else {
    objectId = `fallback_id_${Math.random()}`;
    logService.warn(`Result item missing/invalid objectId: ${result.name} ${type}`);
  }

  return { objectId, icon, typeLabel };
}

export type BuildMappedItemsParams = {
  searchItems: SearchResult[];
  activeContext: ActiveContext | null;
  shortcutStore: ItemShortcut[];
  localSearchValue: string;
  selectedIndex: number;
  onError: (message: string) => void;
  /** Live subtitle overrides from commandService — keyed by commandObjectId. */
  liveSubtitles?: Record<string, string | null>;
  /** Currently active runs — injected as MappedSearchItems at the top of the list
   * so they participate in keyboard navigation alongside normal commands. */
  activeRuns?: Run[];
  /** Unacknowledged failed runs from the current session — rendered alongside
   * active runs so failures stay visible until the user explicitly dismisses
   * (via Cmd+K → Dismiss). Rendered after active runs, before search results. */
  failedRuns?: Run[];
};

function runKindLabel(kind: Run['kind']): string {
  // 'ai-chat' is a legacy run kind preserved for historical row deserialization.
  switch (kind) {
    case 'agent':
      return 'Agent';
    case 'shell-script':
      return 'Script';
    case 'custom':
      return 'Run';
    default:
      return 'Agent';
  }
}

function runKindIcon(kind: Run['kind']): string {
  // 'ai-chat' is a legacy run kind preserved for historical row deserialization.
  switch (kind) {
    case 'agent':
      return 'icon:ai-chat';
    case 'shell-script':
      return 'icon:dev-tools';
    case 'custom':
      return 'icon:activity';
    default:
      return 'icon:ai-chat';
  }
}

function buildRunMappedItem(run: Run): MappedSearchItem {
  const isFailed = run.status === 'failed';
  const subtitle = isFailed
    ? run.errorMessage
      ? `Failed · ${run.errorMessage}`
      : 'Failed'
    : 'Running';
  return {
    object_id: `run_${run.id}`,
    title: run.label,
    subtitle,
    type: isFailed ? 'run-failed' : 'run',
    typeLabel: runKindLabel(run.kind),
    icon: runKindIcon(run.kind),
    score: 1.0,
    action: () => {
      runService.selectedRunId = run.id;
      viewManager.navigateToView('runs/RunView');
    },
  };
}

export type BuildMappedItemsResult = {
  mappedItems: MappedSearchItem[];
  selectedOriginal: SearchResult | null;
};

/**
 * Maps raw SearchResult[] into MappedSearchItem[] for display in ResultsList.
 * Handles portal injection, shortcut lookup, and per-item action closures.
 * Extracted from +page.svelte to keep the component thin.
 */
export function buildMappedItems({
  searchItems,
  activeContext,
  shortcutStore,
  localSearchValue,
  selectedIndex,
  onError,
  liveSubtitles,
  activeRuns = [],
  failedRuns = [],
}: BuildMappedItemsParams): BuildMappedItemsResult {
  // --- Portal injection for url/view-type contexts ---
  let baseItems: SearchResult[] = searchItems;
  if (activeContext && activeContext.provider.type !== 'stream') {
    const ctx = activeContext;
    const portalResult: SearchResult = {
      objectId: `cmd_portals_${ctx.provider.id.replace('portal_', '')}`,
      name: ctx.provider.display.name,
      type: 'command' as const,
      score: 1.0,
      icon: ctx.provider.display.icon,
      extensionId: ctx.provider.type === 'url' ? 'portals' : ctx.provider.id,
    };
    baseItems = [portalResult, ...searchItems.filter(r => r.objectId !== portalResult.objectId)];
  }

  // --- Shortcut lookup map ---
  const shortcutMap = new Map<string, ItemShortcut>(
    shortcutStore.map((s: ItemShortcut) => [s.objectId, s])
  );

  // --- Map each result to a display item ---
  const mappedItems: MappedSearchItem[] = baseItems.map(result => {
    const { objectId, icon, typeLabel } = resolveItemMeta(
      result,
      (id) => extensionManager.getManifestById?.(id) ?? null
    );

    const name = result.name || 'Unknown Item';
    const type = result.type || 'unknown';
    const score = result.score || 0;
    const path = result.path;
    const extensionAction = result.action;

    let actionFunction: () => Promise<any>;

    if (typeof extensionAction === 'function') {
      const originalExtAction = extensionAction;
      actionFunction = async () => {
        logService.debug(`Executing direct extension action for ${name}`);
        try {
          if (typeof originalExtAction === 'function') {
            await Promise.resolve(originalExtAction());
          } else {
            logService.error(`originalExtAction is not a function for ${name}`);
            onError(`Action is invalid for ${name}`);
          }
        } catch (err) {
          logService.error(`Direct extension action failed: ${err}`);
          onError(`Action failed for ${name}`);
          throw err;
        }
      };
    } else if (type === 'application' && path) {
      actionFunction = async () => {
        logService.debug(`Calling applicationService.open for ${name} (ID: ${objectId}, Path: ${path})`);
        try {
          await applicationService.open({ objectId, name, path, score, type });
        } catch (err) {
          logService.error(`applicationService.open failed: ${err}`);
          onError(`Failed to open ${name}`);
          throw err;
        }
      };
    } else if (type === 'command' && objectId) {
      const commandObjectId = objectId;
      const isPortalCommand = activeContext !== null && objectId === `cmd_portals_${activeContext.provider.id.replace('portal_', '')}`;
      const capturedQuery = isPortalCommand ? activeContext!.query : localSearchValue;
      actionFunction = async () => {
        logService.debug(`[searchResultMapper] Executing command: ${commandObjectId}`);
        try {
          return await extensionManager.handleCommandAction(commandObjectId, { query: capturedQuery });
        } catch (err) {
          logService.error(`extensionManager.handleCommandAction failed: ${err}`);
          onError(`Failed to run command ${name}`);
          throw err;
        }
      };
    } else {
      actionFunction = async () => {
        logService.debug(`No valid action for item: ${name} (${type})`);
        onError(`No action for ${name}`);
        return Promise.resolve();
      };
    }

    // Use live override when present (set by updateCommandMetadata); fall back
    // to the Rust-stored description from the search index otherwise.
    const liveSub = liveSubtitles?.[objectId];
    const subtitle = liveSub !== undefined
      ? (liveSub ?? undefined)        // null → undefined (clears the subtitle)
      : (result.description || undefined);

    return {
      object_id: objectId,
      title: name,
      subtitle,
      type,
      typeLabel,
      icon,
      score,
      action: actionFunction,
      style: result.style,
      shortcut: shortcutMap.get(objectId)?.shortcut,
      // Optimistic override: a freshly assigned alias appears in the chip
      // immediately, before the next search round-trip refreshes result.alias.
      alias: aliasStore.byObjectId.get(objectId) ?? result.alias ?? undefined,
    };
  });

  // --- Inject active + unacknowledged failed runs at the top so they
  // participate in keyboard nav. Active first (in-flight work the user
  // probably wants to monitor), failures second (require dismissal but
  // are less urgent). Runs aren't backed by SearchResult entries (they
  // live in the runService registry, not the search index), so they have
  // no equivalent in baseItems and selectedOriginal stays null when a
  // run row is selected.
  const activeItems: MappedSearchItem[] = activeRuns.map(buildRunMappedItem);
  const failedItems: MappedSearchItem[] = failedRuns.map(buildRunMappedItem);
  const runItems = [...activeItems, ...failedItems];
  const allMappedItems = [...runItems, ...mappedItems];

  // --- Derive selected original ---
  // Runs appear at indices [0, runItems.length); shift the lookup into baseItems.
  const baseItemIdx = selectedIndex - runItems.length;
  const selectedOriginal = (baseItemIdx >= 0 && baseItemIdx < baseItems.length)
    ? baseItems[baseItemIdx]
    : null;

  return { mappedItems: allMappedItems, selectedOriginal };
}
