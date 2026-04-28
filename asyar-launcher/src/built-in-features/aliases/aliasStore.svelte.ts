import type { ItemAlias } from '../../bindings';
import { aliasService } from './aliasService';

/**
 * Reactive cache of all configured aliases. Refreshed on demand from the
 * Rust side via `aliasService.list()`. Provides a `byObjectId` map so the
 * search-result row component (and the searchResultMapper) can look up an
 * alias for a given object_id in O(1) without an IPC round-trip.
 *
 * Optimistic updates (`addOptimistic`/`removeOptimistic`) let UI surfaces
 * (the ⌘K AliasCapture modal, the Settings tab) reflect a new alias chip
 * immediately after a successful register/unregister, before the next
 * search round-trip surfaces it via `result.alias`.
 */
class AliasStore {
  list = $state<ItemAlias[]>([]);

  byObjectId: Map<string, string> = $derived.by(() => {
    const map = new Map<string, string>();
    for (const a of this.list) map.set(a.objectId, a.alias);
    return map;
  });

  async refresh(): Promise<void> {
    this.list = await aliasService.list();
  }

  /** Append/replace an alias entry locally after a successful register. */
  addOptimistic(alias: ItemAlias): void {
    this.list = [
      alias,
      ...this.list.filter((a) => a.objectId !== alias.objectId && a.alias !== alias.alias),
    ];
  }

  /** Drop an alias entry locally after a successful unregister. */
  removeOptimistic(alias: string): void {
    this.list = this.list.filter((a) => a.alias !== alias);
  }

  /** Test helper: clear all cached entries. */
  reset(): void {
    this.list = [];
  }
}

export const aliasStore = new AliasStore();

export type { ItemAlias };
