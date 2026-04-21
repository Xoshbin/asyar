export interface ExtensionLite {
  manifest: { id: string };
  enabled: boolean;
  isBuiltIn: boolean;
}

export interface IframeEntry {
  extensionId: string;
  mountToken: number;
}

/**
 * Pick registry entries whose extension is enabled, not built-in, and
 * not currently being shown as the active foreground view.
 */
export function computeBackgroundIframeSet(
  entries: ReadonlyArray<IframeEntry>,
  extensions: ReadonlyArray<ExtensionLite>,
  activeView: string | null | undefined,
): IframeEntry[] {
  const enabledSet = new Set(
    extensions.filter((e) => e.enabled && !e.isBuiltIn).map((e) => e.manifest.id),
  );
  const activeExt = activeView?.split('/')[0] ?? null;
  return entries.filter(
    (e) => enabledSet.has(e.extensionId) && e.extensionId !== activeExt,
  );
}
