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
import { agentsManager } from '../built-in-features/agents/agentsManager.svelte';
import { agentsFindRunOrigin } from './ipc/commands';

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
  /** Kept (succeeded) agent runs — persistent thread rows the user hasn't
   * dismissed yet. Rendered after active + failed so all surfaced runs sit
   * above the catalog. Per the lifecycle policy: scripts auto-remove on
   * success; agent threads persist until manually dismissed. */
  keptAgentRuns?: Run[];
  /** When non-empty, runs are demoted below the mapped search results.
   * When empty, runs are prepended (default-mode browse view). */
  query?: string;
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

function buildRunAction(runId: string, runKind: string): () => Promise<void> {
  if (runKind === 'agent' || runKind === 'ai-chat') {
    return async () => {
      logService.debug(`[searchResultMapper] Opening agent chat for run: ${runId}`);
      try {
        const origin = await agentsFindRunOrigin(runId);
        if (!origin) {
          logService.warn(`[searchResultMapper] no thread found for run ${runId}`);
          runService.selectedRunId = runId;
          viewManager.navigateToView('runs/RunView');
          return;
        }
        agentsManager.currentAgentId = origin.agentId;
        agentsManager.currentThreadId = origin.threadId;
        viewManager.navigateToView('agents/AgentChatView');
      } catch (err) {
        logService.warn(`[searchResultMapper] navigation to thread failed: ${err}`);
        runService.selectedRunId = runId;
        viewManager.navigateToView('runs/RunView');
      }
    };
  } else {
    return async () => {
      logService.debug(`[searchResultMapper] Opening RunView for run: ${runId}`);
      runService.selectedRunId = runId;
      viewManager.navigateToView('runs/RunView');
    };
  }
}

function buildRunMappedItem(run: Run): MappedSearchItem {
  // Three row variants are emitted today:
  //   - 'run'        — live run, blue active dot via statusForRow
  //   - 'run-failed' — failed run, subtitle conveys failure (no dot)
  //   - 'run-done'   — kept (succeeded) agent thread, green done dot
  const isFailed = run.status === 'failed';
  const isKeptDone = run.status === 'succeeded';
  const type = isFailed ? 'run-failed' : isKeptDone ? 'run-done' : 'run';
  const subtitle = isFailed
    ? run.errorMessage
      ? `Failed · ${run.errorMessage}`
      : 'Failed'
    : isKeptDone
      ? 'Done'
      : 'Running';
  return {
    object_id: `run_${run.id}`,
    title: run.label,
    subtitle,
    type,
    typeLabel: runKindLabel(run.kind),
    icon: runKindIcon(run.kind),
    score: 1.0,
    action: buildRunAction(run.id, run.kind),
  };
}

// Mirrors the Rust ranker's tier classification (search_engine/ranker.rs) for
// the bits we can compute from TS. Used to interleave runs with mappedItems by
// match quality without re-running the Rust ranker. Note: tier 3 here is plain
// substring rather than Skim fuzzy — the launcher only has Run.label and the
// query string in TS, no access to fuzzy_score.
type MatchTier = 1 | 2 | 3 | 4;

function matchTier(text: string, query: string): MatchTier {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 1;
  if (t.startsWith(q)) return 2;
  if (t.includes(q)) return 3;
  return 4;
}

function getSectionWeight(item: MappedSearchItem): number {
  // Section Order: scripts (0), agents (1), commands (2)
  // Keep this weight function exactly aligned with SECTION_ORDER and
  // categorizeItem in src/components/list/sectionedListLogic.ts.
  if (item.type === 'run' || item.type === 'run-failed' || item.type === 'run-done') {
    if (item.typeLabel === 'Script') return 0;
    if (item.typeLabel === 'Agent') return 1;
    return 2;
  }
  if (item.object_id.startsWith('cmd_scripts_dyn_')) return 0;
  return 2;
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
  keptAgentRuns = [],
  query,
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

  const hasQuery = (query ?? '').trim().length > 0;

  // In empty-query mode, only show script definitions if they have an active or failed run.
  // Succeeded scripts must disappear completely from the default launcher results.
  if (!hasQuery) {
    baseItems = baseItems.filter((item) => {
      if (!item.objectId.startsWith('cmd_scripts_dyn_')) return true;
      const isLive = activeRuns.some((r) => r.subjectId === item.objectId);
      const isFailed = failedRuns.some((r) => r.subjectId === item.objectId);
      return isLive || isFailed;
    });
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
    let subtitle = result.description;

    const matchingRun = objectId ? (
      activeRuns.find(r => r.subjectId === objectId) ||
      failedRuns.find(r => r.subjectId === objectId) ||
      keptAgentRuns.find(r => r.subjectId === objectId)
    ) : null;

    if (matchingRun) {
      actionFunction = buildRunAction(matchingRun.id, matchingRun.kind);
      
      if (matchingRun.status === 'failed') {
        subtitle = matchingRun.errorMessage ? `Failed · ${matchingRun.errorMessage}` : 'Failed';
      } else if (matchingRun.status === 'succeeded') {
        subtitle = 'Done';
      }
    } else if (typeof extensionAction === 'function') {
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
    // If matchingRun exists, it overrides everything to show run status.
    const liveSub = liveSubtitles?.[objectId];
    if (!matchingRun) {
      subtitle = liveSub !== undefined
        ? (liveSub ?? undefined)
        : (result.description || undefined);
    }

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

  // --- Inject active + unacknowledged failed + kept-agent runs at the top
  // so they participate in keyboard nav. Order:
  //   1. Active     — in-flight work the user probably wants to monitor.
  //   2. Failed     — require dismissal but are less urgent.
  //   3. Kept-done  — succeeded agent threads kept until the user dismisses
  //                   (per the lifecycle policy: scripts auto-remove on
  //                   success; threads persist).
  // Runs aren't backed by SearchResult entries (they live in the runService
  // registry, not the search index), so they have no equivalent in
  // baseItems and selectedOriginal stays null when a run row is selected.
  //
  // Attributed-run deduplication: when a run's subjectId matches a definition
  // row's objectId in the search index, the definition row already carries
  // the status signal (via statusForRow → computeItemStatus). Showing both
  // the definition row AND a separate run row duplicates the information and
  // confuses keyboard navigation. Filter out attributed runs so only the
  // definition row renders — anonymous runs (no subjectId match) still get
  // their own run rows.
  const q = (query ?? '').trim();

  const definitionIds = new Set(baseItems.map(r => r.objectId));
  const isAttributed = (run: Run) => !!run.subjectId && definitionIds.has(run.subjectId);

  const unattributedActive = activeRuns.filter(r => !isAttributed(r));
  const unattributedFailed = failedRuns.filter(r => !isAttributed(r));
  const unattributedKept   = keptAgentRuns.filter(r => !isAttributed(r));

  const activeItems = unattributedActive.map(buildRunMappedItem);
  const failedItems = unattributedFailed.map(buildRunMappedItem);
  const keptItems   = unattributedKept.map(buildRunMappedItem);

  if (!hasQuery) {
    // Default-mode browse view: empty-query sectioned list (Scripts / Agents /
    // Commands) lives downstream. To ensure keyboard navigation is consistent
    // with visual rendering, we must pre-sort the items by the exact same
    // section weighting before returning.
    const runItems = [...activeItems, ...failedItems, ...keptItems];
    // JS Array.prototype.sort is guaranteed stable since ES2019, so within
    // the same weight, the original [runs -> catalog] order is preserved.
    const allMappedItems = [...runItems, ...mappedItems].sort(
      (a, b) => getSectionWeight(a) - getSectionWeight(b)
    );
    const selectedEntry = selectedIndex >= 0 && selectedIndex < allMappedItems.length
      ? allMappedItems[selectedIndex]
      : null;
    const selectedOriginal = selectedEntry
      ? baseItems.find(r => r.objectId === selectedEntry.object_id) ?? null
      : null;
    return { mappedItems: allMappedItems, selectedOriginal };
  }

  // Non-empty query: interleave matching runs into mappedItems by tier. A run
  // with tier T is placed right before the first mappedItem whose tier > T,
  // so a stronger-match run can rise above weaker catalog hits. Within the
  // same tier, mappedItems come first to preserve Rust's within-tier ordering
  // (fuzzy_score + frecency tiebreakers, which TS can't replicate). Runs
  // that don't match (tier 4) sink to the bottom in active → failed → kept
  // order.
  type Tagged =
    | { kind: 'mapped'; item: MappedSearchItem; baseIdx: number; tier: MatchTier }
    | { kind: 'run';    item: MappedSearchItem; tier: MatchTier };

  const taggedMapped: Tagged[] = mappedItems.map((item, idx) => ({
    kind: 'mapped',
    item,
    baseIdx: idx,
    tier: matchTier(item.title ?? '', q),
  }));

  const taggedRuns: Tagged[] = [
    ...activeItems.map((item, i) => ({ kind: 'run' as const, item, tier: matchTier(unattributedActive[i].label, q) })),
    ...failedItems.map((item, i) => ({ kind: 'run' as const, item, tier: matchTier(unattributedFailed[i].label, q) })),
    ...keptItems.map  ((item, i) => ({ kind: 'run' as const, item, tier: matchTier(unattributedKept[i].label, q) })),
  ];

  // Stable-sort by tier ascending; Array.prototype.sort is stable in modern
  // engines, so active → failed → kept ordering is preserved within a tier.
  const matchingRuns    = taggedRuns.filter(r => r.tier < 4).sort((a, b) => a.tier - b.tier);
  const nonMatchingRuns = taggedRuns.filter(r => r.tier === 4);

  const merged: Tagged[] = [];
  let ri = 0;
  for (const m of taggedMapped) {
    while (ri < matchingRuns.length && matchingRuns[ri].tier < m.tier) {
      merged.push(matchingRuns[ri++]);
    }
    merged.push(m);
  }
  while (ri < matchingRuns.length) {
    merged.push(matchingRuns[ri++]);
  }
  merged.push(...nonMatchingRuns);

  const allMappedItems = merged.map(e => e.item);
  const selectedEntry = merged[selectedIndex];
  const selectedOriginal = selectedEntry?.kind === 'mapped'
    ? baseItems[selectedEntry.baseIdx]
    : null;

  return { mappedItems: allMappedItems, selectedOriginal };
}
