import type { ThemeDefinition, ThemeFontEntry } from './ipc/extensionCommands';

export interface ParsedThemeId {
  extensionId: string;
  variantId: string | null;
}

/**
 * Splits a theme selection ID (`"org.asyar.tokyo-night#storm"` or `"org.asyar.catppuccin"`)
 * into its base extension ID and optional variant ID.
 */
export function parseThemeId(themeId: string): ParsedThemeId {
  const hashIndex = themeId.indexOf('#');
  if (hashIndex === -1) {
    return { extensionId: themeId, variantId: null };
  }
  const extensionId = themeId.slice(0, hashIndex);
  const variantId = themeId.slice(hashIndex + 1) || null;
  return { extensionId, variantId };
}

/**
 * Formats an extension ID and optional variant ID into a single `activeTheme` string.
 */
export function formatThemeId(extensionId: string, variantId?: string | null): string {
  return variantId ? `${extensionId}#${variantId}` : extensionId;
}

/**
 * Returns true if `activeThemeId` belongs to `extensionId` (exact match or `extensionId#variant`).
 */
export function matchesThemeExtension(
  activeThemeId: string | null | undefined,
  extensionId: string,
): boolean {
  if (!activeThemeId) return false;
  return parseThemeId(activeThemeId).extensionId === extensionId;
}

/**
 * Resolves the `{ variables, fonts }` for a given `variantId` from a `ThemeDefinition`.
 * Falls back to the first variant when `variants` is non-empty and `variantId` is omitted
 * or not found, or to the top-level `{ variables, fonts }` for single-theme packages.
 */
export function resolveThemeVariant(
  definition: ThemeDefinition,
  variantId: string | null,
): { variables: Record<string, string>; fonts: ThemeFontEntry[] } {
  const variants = definition.variants ?? [];
  if (variants.length > 0) {
    const matched = variantId ? variants.find((v) => v.id === variantId) : undefined;
    const chosen = matched ?? variants[0];
    return {
      variables: { ...(definition.variables ?? {}), ...(chosen.variables ?? {}) },
      fonts: chosen.fonts?.length ? chosen.fonts : (definition.fonts ?? []),
    };
  }
  return {
    variables: definition.variables ?? {},
    fonts: definition.fonts ?? [],
  };
}
