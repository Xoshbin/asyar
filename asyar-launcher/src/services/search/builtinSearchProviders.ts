import { logService } from '../log/logService';

/**
 * A row a built-in contributes to root search. Plain data only: it crosses the
 * `mergedSearch` boundary into Rust ranking, so it must survive structured
 * clone. Behaviour is NOT carried on the row — the owning provider's
 * {@link BuiltinSearchProvider.execute} runs it from `id` + `actionPayload`.
 */
export interface BuiltinSearchRow {
  /** Stable within the provider; used to route execution back. */
  id: string;
  title: string;
  subtitle?: string;
  score?: number;
  icon?: string;
  style?: 'default' | 'large';
  priority?: 'top';
  actionPayload?: unknown;
  /** Overrides the bottom bar's Enter label ("Run"/"Open"), e.g. "Copy". Already localized. */
  primaryActionLabel?: string;
}

export type BuiltinSearchHit = BuiltinSearchRow & { extensionId: string };

/**
 * An extra ⌘K action a built-in contributes for one of its own root rows
 * (e.g. the calculator's "Copy as HEX"). Labels are already localized.
 */
export interface BuiltinRowAction {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category?: string;
  execute(): Promise<void> | void;
}

/**
 * A statically compiled platform primitive's root-search contribution.
 * Built-ins are not pseudo-extensions: they register here directly and are
 * never routed through extension aggregation or closure-stripping tables.
 */
export interface BuiltinSearchProvider {
  extensionId: string;
  search(query: string): Promise<BuiltinSearchRow[]>;
  execute(rowId: string, actionPayload?: unknown): Promise<void> | void;
  /**
   * ⌘K actions for one of this provider's rows, derived only from the row's
   * own `id` + `actionPayload` — no provider state, so a late search can
   * never leave a row pointing at another query's data.
   */
  rowActions?(rowId: string, actionPayload?: unknown): BuiltinRowAction[];
}

const DEFAULT_PROVIDER_BUDGET_MS = 200;

const providers = new Map<string, BuiltinSearchProvider>();

/**
 * Registers (or replaces) the provider for a built-in. The returned disposer
 * only removes the registration it created, so a late dispose of a replaced
 * provider cannot evict its successor.
 */
export function registerBuiltinSearchProvider(provider: BuiltinSearchProvider): () => void {
  providers.set(provider.extensionId, provider);
  return () => {
    if (providers.get(provider.extensionId) === provider) {
      providers.delete(provider.extensionId);
    }
  };
}

export function resetBuiltinSearchProviders(): void {
  providers.clear();
}

/**
 * Collects rows from every enabled built-in provider. `isEnabled` gates
 * presentation only — a disabled built-in's platform services stay available
 * through the ServiceRegistry. A slow or failing provider is dropped, never
 * allowed to delay or fail the query.
 */
export async function searchBuiltinProviders(
  query: string,
  isEnabled: (extensionId: string) => boolean,
  budgetMs: number = DEFAULT_PROVIDER_BUDGET_MS,
): Promise<BuiltinSearchHit[]> {
  const active = [...providers.values()].filter((p) => isEnabled(p.extensionId));

  const perProvider = await Promise.all(
    active.map(async (provider): Promise<BuiltinSearchHit[]> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const rows = await Promise.race([
          provider.search(query),
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), budgetMs);
          }),
        ]);
        if (rows === null) {
          logService.debug(
            `[builtinSearch] ${provider.extensionId} exceeded ${budgetMs}ms; dropped for this query`,
          );
          return [];
        }
        return (rows ?? []).map((row) => ({ ...row, extensionId: provider.extensionId }));
      } catch (error) {
        logService.error(`Error searching in built-in ${provider.extensionId}: ${error}`);
        return [];
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );

  return perProvider.flat();
}

/** Runs a row through its owning provider. Returns false when nothing owns it. */
export async function executeBuiltinSearchResult(
  extensionId: string,
  rowId: string,
  actionPayload?: unknown,
): Promise<boolean> {
  const provider = providers.get(extensionId);
  if (!provider) return false;
  await provider.execute(rowId, actionPayload);
  return true;
}

/** The ⌘K actions the owning provider contributes for a row; empty when none. */
export function getBuiltinRowActions(
  extensionId: string,
  rowId: string,
  actionPayload?: unknown,
): BuiltinRowAction[] {
  return providers.get(extensionId)?.rowActions?.(rowId, actionPayload) ?? [];
}
