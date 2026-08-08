/** All CSS custom property names that belong to the Asyar design system. */
export const THEME_VAR_NAMES: readonly string[] = [
  '--bg-primary',
  '--bg-secondary',
  '--bg-tertiary',
  '--bg-hover',
  '--bg-selected',
  '--bg-popup',
  '--bg-secondary-full-opacity',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--text-on-accent',
  '--border-color',
  '--separator',
  '--accent-primary',
  '--accent-success',
  '--accent-warning',
  '--accent-danger',
  '--syntax-comment',
  '--syntax-keyword',
  '--syntax-string',
  '--syntax-number',
  '--syntax-function',
  '--accent-primary-rgb',
  '--shadow-color',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--shadow-popup',
  '--shadow-focus',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-full',
  '--space-0-5',
  '--space-1',
  '--space-1-5',
  '--space-2',
  '--space-2-5',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-5-5',
  '--space-6',
  '--space-7',
  '--space-7-5',
  '--space-8',
  '--space-9',
  '--space-10',
  '--space-11',
  '--font-size-2xs',
  '--font-size-xs',
  '--font-size-sm',
  '--font-size-md',
  '--font-size-base',
  '--font-size-lg',
  '--font-size-xl',
  '--font-size-2xl',
  '--font-size-3xl',
  '--font-size-section',
  '--font-size-display',
  '--font-ui',
  '--font-mono',
  '--transition-fast',
  '--transition-normal',
  '--transition-smooth',
  '--transition-slow',
  '--asyar-brand',
  '--asyar-brand-hover',
  '--asyar-brand-muted',
  '--asyar-brand-subtle',
  '--scrollbar-thumb',
  '--control-knob',
];

/**
 * The subset of design tokens a custom theme extension is allowed to override.
 *
 * A theme recolors the app — it must never resize its layout. The spacing
 * scale (`--space-*`) and type scale (`--font-size-*`) are design-system-owned:
 * a third-party theme shipping its own (larger, or incomplete) values would
 * reflow and overflow real UI like the Settings tab row. Those tokens are
 * still collected for iframe injection via `THEME_VAR_NAMES`, but `applyTheme`
 * filters overrides through this narrower list so themes can only change
 * color, shadow, radius, font family, and transition tokens.
 */
export const THEMEABLE_VAR_NAMES: readonly string[] = THEME_VAR_NAMES.filter(
  (name) => !name.startsWith('--space-') && !name.startsWith('--font-size-'),
);

/**
 * Reads the current computed values of all Asyar design token CSS variables
 * from the given element (should be document.documentElement).
 * Returns a plain object mapping variable name → computed value string.
 */
export function collectThemeVariables(element: HTMLElement): Record<string, string> {
  const styles = getComputedStyle(element);
  const vars: Record<string, string> = {};

  for (const name of THEME_VAR_NAMES) {
    const value = styles.getPropertyValue(name).trim();
    if (value) {
      vars[name] = value;
    }
  }

  return vars;
}
