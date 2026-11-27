import { getThemeDefinition } from '../../lib/ipc/commands';
import { THEMEABLE_VAR_NAMES } from '../../lib/themeVariables';
import { parseThemeId, resolveThemeVariant } from '../../lib/themeVariants';

export const THEME_STYLE_ID = 'asyar-theme-fonts';

let appliedVariableNames: string[] = [];

/**
 * Apply a theme extension's CSS variables and fonts to the document.
 * Supports both single-theme IDs (`"org.asyar.catppuccin"`) and variant IDs
 * (`"org.asyar.tokyo-night#storm"`).
 */
export async function applyTheme(themeId: string): Promise<void> {
  removeTheme();

  const { extensionId, variantId } = parseThemeId(themeId);
  const definition = await getThemeDefinition(extensionId);
  const { variables, fonts } = resolveThemeVariant(definition, variantId);

  const allowedSet = new Set(THEMEABLE_VAR_NAMES);
  for (const [name, value] of Object.entries(variables)) {
    if (allowedSet.has(name)) {
      document.documentElement.style.setProperty(name, value);
      appliedVariableNames.push(name);
    }
  }

  if (fonts.length > 0) {
    const fontFaceRules = fonts.map((font) => {
      const weight = font.weight ?? '400';
      const style = font.style ?? 'normal';
      return `@font-face {
  font-family: "${font.family}";
  src: url("asyar-extension://${extensionId}/${font.src}");
  font-weight: ${weight};
  font-style: ${style};
}`;
    });

    const styleEl = document.createElement('style');
    styleEl.id = THEME_STYLE_ID;
    styleEl.textContent = fontFaceRules.join('\n');
    document.head.appendChild(styleEl);
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

  const existing = document.getElementById(THEME_STYLE_ID);
  if (existing) {
    existing.remove();
  }

  delete document.documentElement.dataset.customTheme;
}
