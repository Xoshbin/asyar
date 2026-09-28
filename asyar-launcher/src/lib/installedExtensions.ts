export interface MinimalExtensionLike {
  id?: string | number | null;
  slug?: string | null;
  name?: string | null;
  manifest?: {
    id?: string | null;
    name?: string | null;
    [key: string]: unknown;
  } | null;
}

/**
 * Checks whether an extension from a store/featured listing is installed locally,
 * matching against paths or IDs returned by `listInstalledExtensions()`.
 *
 * Handles:
 * - Direct matches (unit tests or normalized IDs: 'org.asyar.browser')
 * - Absolute POSIX/macOS paths (e.g. '/Users/.../extensions/org.asyar.browser')
 * - Absolute Windows paths (e.g. 'C:\\...\\extensions\\org.asyar.browser')
 * - Trailing slashes
 * - Matching by manifest.id, store item id (number or string), or slug
 */
export function isExtensionInstalled(
  extension: MinimalExtensionLike | null | undefined,
  installedPaths: string[] | Set<string> | null | undefined,
): boolean {
  if (!extension || !installedPaths) return false;
  const paths = Array.isArray(installedPaths) ? installedPaths : Array.from(installedPaths);
  if (paths.length === 0) return false;

  const candidates = new Set<string>();
  if (extension.manifest?.id) candidates.add(extension.manifest.id);
  if (extension.id !== undefined && extension.id !== null) {
    candidates.add(String(extension.id));
  }
  if (extension.slug) candidates.add(extension.slug);

  if (candidates.size === 0) return false;

  for (const path of paths) {
    if (!path) continue;
    // Fast path: exact string match
    if (candidates.has(path)) return true;

    // Normalize path separators and extract folder name
    const normalized = path.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    const basename = segments[segments.length - 1];
    if (basename && candidates.has(basename)) return true;

    for (const candidate of candidates) {
      if (normalized === candidate || normalized.endsWith(`/${candidate}`)) {
        return true;
      }
    }
  }

  return false;
}

export function isEmojiInstalled(
  installedPaths: string[] | Set<string> | null | undefined,
  emojiId = 'org.asyar.emoji',
): boolean {
  return isExtensionInstalled(
    { id: emojiId, slug: 'emoji', manifest: { id: emojiId } },
    installedPaths,
  );
}
