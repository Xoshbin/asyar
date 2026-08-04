import { invokeSafe } from './invokeSafe';
import { bumpArgumentHintVersion } from '../launcher/argumentHintVersion.svelte';

/**
 * Load the last-submitted argument values for a command.
 * Returns an empty object if nothing has been persisted yet.
 * Password-typed arguments are never persisted, so they will
 * always be absent from the returned map.
 *
 * `isDynamic` selects the `dynamic:`-prefixed storage row so a dynamic
 * command's persisted values can never collide with a manifest command of
 * the same id — the prefix is applied server-side, not mirrored here.
 */
export async function commandArgDefaultsGet(
  extensionId: string,
  commandId: string,
  isDynamic: boolean,
): Promise<Record<string, string> | null> {
  return invokeSafe<Record<string, string>>('command_arg_defaults_get', {
    extensionId,
    commandId,
    isDynamic,
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
  isDynamic: boolean,
  values: Record<string, string>,
): Promise<void> {
  await invokeSafe('command_arg_defaults_set', { extensionId, commandId, isDynamic, values });
  // The ghost chips preview these values, so they are now a version behind.
  bumpArgumentHintVersion();
}
