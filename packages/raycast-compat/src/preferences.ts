import { getActiveContext } from './context';

/**
 * Returns the effective preferences for the current extension and command.
 */
export function getPreferenceValues<T = Record<string, any>>(): T {
  const ctx = getActiveContext();
  const rawValues = (ctx.preferences?.values ?? {}) as Record<string, any>;

  let commandId: string | undefined = undefined;
  if (typeof window !== 'undefined') {
    const injected = (window as any).__ASYAR_ENVIRONMENT__;
    if (injected?.commandId) {
      commandId = injected.commandId;
    } else if (window.location) {
      const search = new URLSearchParams(window.location.search);
      commandId = search.get('command') || search.get('view') || undefined;
    }
  } else if (typeof globalThis !== 'undefined') {
    const injected = (globalThis as any).__ASYAR_ENVIRONMENT__;
    if (injected?.commandId) {
      commandId = injected.commandId;
    }
  }

  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (k !== 'commands') {
      result[k] = v;
    }
  }

  if (commandId && rawValues.commands && typeof rawValues.commands === 'object') {
    const cmdPrefs = rawValues.commands[commandId];
    if (cmdPrefs && typeof cmdPrefs === 'object') {
      Object.assign(result, cmdPrefs);
    }
  }

  return result as T;
}
