import { getThemeDefinition } from '../../lib/ipc/commands';
import type { ThemeDefinition } from '../../lib/ipc/commands';
import { THEME_VAR_NAMES } from '../../lib/themeVariables';
import { syncNativeBarStyle } from './nativeBarSync';

export const THEME_STYLE_ID = 'asyar-theme-fonts';

let appliedVariableNames: string[] = [];

// The native macOS Show More bar can't observe CSS var changes — push colors
// to Rust after each apply/remove. rAF lets the style commit so
// getComputedStyle reads the new values.
function queueNativeBarResync(): void {
  if (typeof requestAnimationFrame === 'undefined') {
    void syncNativeBarStyle();
    return;
  }
  requestAnimationFrame(() => void syncNativeBarStyle());
}

/**
 * Apply a theme extension's CSS variables and fonts to the document.
 * Calls Rust get_theme_definition command (file I/O stays in Rust).
 */
export async function applyTheme(themeId: string): Promise<void> {
  removeTheme();

  const definition: ThemeDefinition = await getThemeDefinition(themeId);

  const allowedSet = new Set(THEME_VAR_NAMES);
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

  queueNativeBarResync();
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

  queueNativeBarResync();
}
