import type { ExtensionCommand } from 'asyar-sdk/contracts';
import { searchBarAccessoryService } from './searchBarAccessoryService.svelte';

/**
 * Pure helper: if the given command declares a non-empty dropdown
 * searchBarAccessory, declare it on the service for `(extensionId,
 * commandId)`. Otherwise no-op. Extracted from the view-mount lifecycle
 * effect so the branching logic can be unit-tested without Svelte runes.
 */
export async function applyAccessoryFromCommand(
  command: ExtensionCommand | undefined,
  extensionId: string,
  commandId: string,
): Promise<void> {
  const acc = command?.searchBarAccessory;
  if (!acc || acc.type !== 'dropdown' || acc.options.length === 0) {
    return;
  }
  await searchBarAccessoryService.declare({
    extensionId,
    commandId,
    options: acc.options,
    default: acc.default,
  });
}
