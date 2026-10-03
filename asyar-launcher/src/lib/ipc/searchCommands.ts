// asyar-launcher/src/lib/ipc/searchCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type {
  AliasConflict,
  ItemAlias,
  MergedSearchResponse,
  SearchResult,
  SearchableItem,
} from '../../bindings';

export type ExternalSearchResult = {
  objectId: string;
  name: string;
  description?: string | null;
  type: string;
  score: number;
  icon?: string | null;
  extensionId?: string | null;
  category?: string | null;
  style?: string | null;
};

// ── Search ────────────────────────────────────────────────────────────────────

// Shared with ExtensionIpcRouter's EXTENSION_INVOKE_DISPATCH table (which
// relies on the default, non-silent report) — SearchService.performSearch
// passes silent:true since it reports its own, more specific diagnostic.
export async function searchItems(
  query: string,
  opts?: { silent?: boolean },
): Promise<SearchResult[]> {
  return invokeSafe<SearchResult[]>('search_items', { query }, opts);
}

export async function mergedSearch(
  query: string,
  externalResults: ExternalSearchResult[],
  minResults?: number,
): Promise<MergedSearchResponse> {
  return invokeSafe<MergedSearchResponse>('merged_search', { query, externalResults, minResults });
}

// ── Aliases ───────────────────────────────────────────────────────────────────

export async function setAlias(
  objectId: string,
  alias: string,
  itemName: string,
  itemType: 'application' | 'command',
): Promise<ItemAlias> {
  return invokeSafe('set_alias', { objectId, alias, itemName, itemType });
}

export async function unsetAlias(alias: string): Promise<void> {
  await invokeSafe('unset_alias', { alias });
}

export async function listAliases(): Promise<ItemAlias[]> {
  return invokeSafe('list_aliases');
}

export async function findAliasConflict(
  alias: string,
  excludingObjectId?: string,
): Promise<AliasConflict | null> {
  return invokeSafe<AliasConflict | null>('find_alias_conflict', { alias, excludingObjectId });
}

export async function getIndexedItems(): Promise<SearchableItem[]> {
  return invokeSafe('get_indexed_items');
}

// `Result<(), AppError>` convenience: true on success, typed rejection on failure.
export async function indexItem(item: SearchableItem): Promise<boolean> {
  return invokeSafeVoid('index_item', { item }, { silent: true });
}

export async function batchIndexItems(items: SearchableItem[]): Promise<void> {
  await invokeSafe('batch_index_items', { items });
}

export async function deleteItem(objectId: string): Promise<void> {
  await invokeSafe('delete_item', { objectId });
}

export async function getIndexedObjectIds(): Promise<Set<string>> {
  const arr = await invokeSafe<string[]>('get_indexed_object_ids');
  return new Set(arr);
}

export async function recordItemUsage(objectId: string): Promise<void> {
  await invokeSafe('record_item_usage', { objectId });
}

export async function setItemFavorite(objectId: string, favorite: boolean): Promise<boolean> {
  return invokeSafe<boolean>('set_item_favorite', { objectId, favorite });
}

// `Result<(), AppError>` convenience: true on success, typed rejection on failure.
export async function resetSearchIndex(): Promise<boolean> {
  return invokeSafeVoid('reset_search_index', undefined, { silent: true });
}

// `Result<(), AppError>` convenience: true on success, typed rejection on failure.
export async function saveSearchIndex(): Promise<boolean> {
  return invokeSafeVoid('save_search_index', undefined, { silent: true });
}
