export function nameToGradient(name: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return {
    from: `hsl(${hue}, 70%, 45%)`,
    to: `hsl(${(hue + 30) % 360}, 70%, 35%)`,
  };
}

/**
 * The Store API's `iconUrl` is an https URL when asyar.org serves the icon
 * it took out of the package; otherwise it is the raw manifest value (emoji,
 * `icon:` name, SVG path), which the Store shows as initials.
 */
export function storeIconSrc(iconUrl: string | null | undefined): string | undefined {
  return iconUrl?.startsWith('https://') ? iconUrl : undefined;
}

export function nameToInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}
