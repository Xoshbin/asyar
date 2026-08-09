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
  // The fill ramp. Separate from the four above because a colour saturated
  // enough to read as text on an Asyar surface is too light to carry white
  // text on top of it — no single value satisfies both. These are the ones
  // verified to carry --text-on-accent at 4.5:1.
  '--accent-primary-fill',
  '--accent-success-fill',
  '--accent-warning-fill',
  '--accent-danger-fill',
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
  // The size scale — the dimensions of objects, as opposed to the gaps
  // between them. Design-system-owned for the same reason as --space-*: an
  // icon tile that a theme grew to 40px would break every row it sits in.
  '--size-xs',
  '--size-sm',
  '--size-md',
  '--size-lg',
  '--size-xl',
  '--size-2xl',
  '--size-3xl',
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
  // Motion primitives. A theme may retime the app (a slower, calmer feel) but
  // the four easing curves carry the design language's physics, so they are
  // filtered out of THEMEABLE_VAR_NAMES below alongside spacing and type.
  '--dur-instant',
  '--dur-quick',
  '--dur-travel',
  '--dur-emerge',
  '--ease-travel',
  '--ease-emerge',
  '--ease-recede',
  '--ease-settle',
  // Tracking scale — design-system-owned, same reasoning as --font-size-*.
  '--tracking-display',
  '--tracking-tight',
  '--tracking-normal',
  '--tracking-wide',
  // The Rim: the top-edge highlight and bottom-edge shade that every raised
  // surface carries. Themeable, because a theme that recolours surfaces must
  // be able to recolour the light landing on them.
  '--rim-light',
  '--rim-shade',
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
 * A theme recolors the app — it must never resize its layout, and it must not
 * rewrite the design language's physics. Five families are design-system-owned:
 *
 *   --space-*     a third-party theme shipping its own (larger, or incomplete)
 *                 spacing would reflow and overflow real UI like the Settings
 *                 tab row.
 *   --size-*      the dimensions of objects rather than the gaps between them.
 *                 An icon tile a theme grew to 40px breaks every row it sits in.
 *   --font-size-* same reasoning, plus the launcher's fixed 480px height leaves
 *                 no slack for a theme that scales type up.
 *   --tracking-*  tracking is drawn to fit Satoshi at these exact sizes.
 *   --ease-*      the four curves ARE the motion language. A theme may retime
 *                 the app via --dur-*, which is allowed through, but a theme
 *                 that swaps in `linear` or a bouncing curve stops being a
 *                 recolor and starts being a different product.
 *
 * All of them are still collected for iframe injection via `THEME_VAR_NAMES`,
 * so extension views render with the real values; `applyTheme` filters
 * *overrides* through this narrower list.
 */
const SYSTEM_OWNED_PREFIXES = ['--space-', '--size-', '--font-size-', '--tracking-', '--ease-'];

export const THEMEABLE_VAR_NAMES: readonly string[] = THEME_VAR_NAMES.filter(
  (name) => !SYSTEM_OWNED_PREFIXES.some((prefix) => name.startsWith(prefix)),
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
