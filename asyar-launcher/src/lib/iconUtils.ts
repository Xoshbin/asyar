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
