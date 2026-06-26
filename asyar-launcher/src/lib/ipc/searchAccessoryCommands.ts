import { invokeSafe, invokeSafeVoid } from './invokeSafe';

export async function rankItemsCommand(query: string, items: unknown[]): Promise<string[] | null> {
  return invokeSafe<string[]>('rank_items', { query, items });
}

export async function searchbarAccessoryGet(
  extensionId: string,
  commandId: string,
  opts?: { silent?: boolean },
): Promise<string | null> {
  return invokeSafe<string | null>('searchbar_accessory_get', { extensionId, commandId }, opts);
}

// `searchbar_accessory_set` is `Result<(), AppError>` on the Rust side — use
// invokeSafeVoid's boolean signal so callers can abort before mutating
// in-memory state on a persistence failure.
export async function searchbarAccessorySet(
  extensionId: string,
  commandId: string,
  value: string,
): Promise<boolean> {
  return invokeSafeVoid('searchbar_accessory_set', { extensionId, commandId, value });
}
