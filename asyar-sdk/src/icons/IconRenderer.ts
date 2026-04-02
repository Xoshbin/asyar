import { ICON_DATA, ICON_NAMES } from './iconData';

export interface IconOptions {
  size?: number;        // default 20
  strokeWidth?: number; // default 1.5
  class?: string;       // CSS class to add to the <svg>
}

/** Returns a complete SVG markup string for the given icon name, or empty string if not found. */
export function renderIcon(name: string, options?: IconOptions): string {
  const iconData = ICON_DATA[name];
  if (!iconData) {
    return '';
  }

  const size = options?.size ?? 20;
  const strokeWidth = options?.strokeWidth ?? 1.5;
  const className = options?.class ? ` class="${options.class}"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${className}>${iconData.trim()}</svg>`;
}

/** Returns a list of all available icon names. */
export function listIcons(): readonly string[] {
  return ICON_NAMES;
}

/** Returns true if the given name exists in the built-in icon set. */
export function hasIcon(name: string): boolean {
  return name in ICON_DATA;
}

/** Returns the raw SVG inner content for the given icon, or undefined. */
export function getIconData(name: string): string | undefined {
  return ICON_DATA[name];
}
