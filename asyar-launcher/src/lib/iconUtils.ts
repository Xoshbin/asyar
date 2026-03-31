/**
 * Utility to determine if a given icon string is an image source (URL, Data URI, or custom scheme)
 * or if it should be rendered as a text/emoji.
 */
export function isIconImage(icon: string | undefined | null): boolean {
  if (!icon) return false;

  return (
    icon.startsWith('data:image') ||
    icon.startsWith('asyar-icon://') ||
    icon.startsWith('asyar-extension://') ||
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('file://') ||
    icon.startsWith('/') // Absolute local paths
  );
}

/**
 * Check if an icon string references a built-in SVG icon via the "icon:" prefix.
 */
export function isBuiltInIcon(icon: string | undefined | null): boolean {
  if (!icon) return false;
  return icon.startsWith('icon:');
}

/**
 * Extract the icon name from an "icon:name" string.
 */
export function getBuiltInIconName(icon: string): string {
  return icon.slice(5); // Remove "icon:" prefix
}
