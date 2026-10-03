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
}

export type BuiltinSearchHit = BuiltinSearchRow & { extensionId: string };

/**
 * A statically compiled platform primitive's root-search contribution.
 * Built-ins are not pseudo-extensions: they register here directly and are
 * never routed through extension aggregation or closure-stripping tables.
 */
export interface BuiltinSearchProvider {
  extensionId: string;
  search(query: string): Promise<BuiltinSearchRow[]>;
  execute(rowId: string, actionPayload?: unknown): Promise<void> | void;
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
