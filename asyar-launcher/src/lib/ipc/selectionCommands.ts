import { invokeRaw } from './invokeSafe';

/**
 * `selectionService` deliberately classifies raw Rust error text into a
 * structured `SelectionErrorCode` and rethrows — `invokeSafe`'s never-throws
 * contract would destroy that, so this uses the `invokeRaw` escape hatch
 * (see `selectionService.ts`'s `throwSelectionError`).
 */
export async function getSelectedTextRaw(): Promise<string | null> {
  return invokeRaw<string | null>('get_selected_text');
}

export async function getSelectedFinderItemsRaw(): Promise<string[]> {
  return invokeRaw<string[]>('get_selected_finder_items');
}
