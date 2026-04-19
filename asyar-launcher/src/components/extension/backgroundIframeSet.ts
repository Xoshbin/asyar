import type { IframeRegistryEntry } from '../../services/extension/extensionIframeRegistry.svelte';

export interface ExtensionLite {
  manifest: { id: string };
  enabled: boolean;
  isBuiltIn: boolean;
}

/**
 * Pick registry entries whose extension is enabled, not built-in, and
 * not currently being shown as the active foreground view.
 */
export function computeBackgroundIframeSet(
  entries: ReadonlyArray<IframeRegistryEntry>,
  extensions: ReadonlyArray<ExtensionLite>,
  activeView: string | null | undefined,
): IframeRegistryEntry[] {
  const enabledSet = new Set(
    extensions.filter((e) => e.enabled && !e.isBuiltIn).map((e) => e.manifest.id),
  );
  const activeExt = activeView?.split('/')[0] ?? null;
  return entries.filter(
    (e) => enabledSet.has(e.extensionId) && e.extensionId !== activeExt,
  );
}
