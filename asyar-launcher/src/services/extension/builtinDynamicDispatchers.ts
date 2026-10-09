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

/**
 * Returned by a dispatcher that wants the launcher left as it is, so the
 * caller skips its usual hide + reset. `view`: the dispatcher navigated to
 * one of its views. `keep-open`: the dispatcher already restored the
 * launcher itself (e.g. `showWindow()` after a failed OS action), and a
 * hide would undo that.
 */
export type BuiltinDispatchResult = { type: 'view'; viewPath: string } | { type: 'keep-open' };

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
