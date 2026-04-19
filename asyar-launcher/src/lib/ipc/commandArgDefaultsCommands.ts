import { invoke } from '@tauri-apps/api/core';

/**
 * Load the last-submitted argument values for a command.
 * Returns an empty object if nothing has been persisted yet.
 * Password-typed arguments are never persisted, so they will
 * always be absent from the returned map.
 */
export async function commandArgDefaultsGet(
  extensionId: string,
  commandId: string
): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('command_arg_defaults_get', {
    extensionId,
    commandId,
  });
}

/**
 * Persist the argument values the user just submitted so the next
 * invocation can pre-fill the chip row. Pass only non-password values;
 * the caller is responsible for filtering them out.
 */
export async function commandArgDefaultsSet(
  extensionId: string,
  commandId: string,
  values: Record<string, string>
): Promise<void> {
  return invoke('command_arg_defaults_set', { extensionId, commandId, values });
}
