import { getThemeDefinition } from '../../lib/ipc/commands';
import type { ThemeDefinition } from '../../lib/ipc/commands';
import { THEMEABLE_VAR_NAMES } from '../../lib/themeVariables';

export const THEME_STYLE_ID = 'asyar-theme-fonts';

let appliedVariableNames: string[] = [];

const BACKGROUND_PROPERTIES = [
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
] as const;

/**
 * Apply a theme extension's CSS variables and fonts to the document.
 * Calls Rust get_theme_definition command (file I/O stays in Rust).
 */
export async function applyTheme(themeId: string): Promise<void> {
  removeTheme();

  const definition = await getThemeDefinition(themeId);

  const allowedSet = new Set(THEMEABLE_VAR_NAMES);
  for (const [name, value] of Object.entries(definition.variables)) {
    if (allowedSet.has(name)) {
      document.documentElement.style.setProperty(name, value);
      appliedVariableNames.push(name);
    }
  }

  if (definition.fonts.length > 0) {
    const fontFaceRules = definition.fonts.map((font) => {
      const weight = font.weight ?? '400';
      const style = font.style ?? 'normal';
      return `@font-face {
  font-family: "${font.family}";
  src: url("asyar-extension://${themeId}/${font.src}");
  font-weight: ${weight};
  font-style: ${style};
}`;
    });

    const styleEl = document.createElement('style');
    styleEl.id = THEME_STYLE_ID;
    styleEl.textContent = fontFaceRules.join('\n');
    document.head.appendChild(styleEl);
  }

  // Layers paint over the root's --bg-primary fill; first layer is on top.
  // Rust validates src/values to a charset that cannot escape url("…").
  const layers = definition.backgrounds ?? [];
  if (layers.length > 0) {
    const root = document.documentElement.style;
    root.setProperty(
      'background-image',
      layers.map((l) => `url("asyar-extension://${themeId}/${l.src}")`).join(', '),
    );
    root.setProperty('background-position', layers.map((l) => l.position ?? '0% 0%').join(', '));
    root.setProperty('background-size', layers.map((l) => l.size ?? 'auto').join(', '));
    root.setProperty('background-repeat', layers.map((l) => l.repeat ?? 'repeat').join(', '));
  }

  // Marker for CSS: while a custom theme is active, the .settings-page opaque
  // overrides (which force system light/dark surfaces) step aside so the
  // theme's full palette — text and accents included — flows through. Without
  // this the settings page keeps system backgrounds but inherits the theme's
  // text colors, producing unreadable low-contrast text.
  document.documentElement.dataset.customTheme = themeId;
}

/**
 * Remove all theme overrides: CSS variables and injected font styles.
 */
export function removeTheme(): void {
  for (const name of appliedVariableNames) {
    document.documentElement.style.removeProperty(name);
  }
  appliedVariableNames = [];

  for (const name of BACKGROUND_PROPERTIES) {
    document.documentElement.style.removeProperty(name);
  }

  const existing = document.getElementById(THEME_STYLE_ID);
  if (existing) {
    existing.remove();
  }

  delete document.documentElement.dataset.customTheme;
}
