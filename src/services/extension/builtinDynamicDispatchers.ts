/**
 * Registry of Tier 1 dispatchers for built-in extensions that produce
 * dynamic commands (`cmd_<extensionId>_dyn_<dynamicId>`). Each built-in
 * registers its dispatcher at module load; `extensionManager.handleCommandAction`
 * looks up the dispatcher by extension id instead of switching on a
 * hardcoded list of extension ids.
 *
 * See `architectural-integrity` skill — "Never Hardcode What Should Be
 * Registered". Same shape as `defineServiceRegistry`: a single source of
 * truth keyed by extension id, populated by the producer, consumed by the
 * orchestrator.
 */

export interface BuiltinDispatchResult {
  /** If true, the launcher stays open after dispatch instead of hiding. */
  keepLauncherOpen?: boolean;
}

export type BuiltinDynamicDispatcher = (
  dynamicId: string,
  args?: Record<string, unknown>,
) => Promise<void | BuiltinDispatchResult>;

const dispatchers = new Map<string, BuiltinDynamicDispatcher>();

export function registerBuiltinDynamicDispatcher(
  extensionId: string,
  dispatcher: BuiltinDynamicDispatcher,
): void {
  dispatchers.set(extensionId, dispatcher);
}

export function unregisterBuiltinDynamicDispatcher(extensionId: string): void {
  dispatchers.delete(extensionId);
}

export function getBuiltinDynamicDispatcher(
  extensionId: string,
): BuiltinDynamicDispatcher | undefined {
  return dispatchers.get(extensionId);
}

export function isBuiltinDynamicExtension(extensionId: string): boolean {
  return dispatchers.has(extensionId);
}
