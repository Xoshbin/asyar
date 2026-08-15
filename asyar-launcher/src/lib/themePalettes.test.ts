/**
 * Guards the two structural promises the token layer makes.
 *
 * 1. PARITY. Each palette is written twice in style.css — once under
 *    `prefers-color-scheme` scoped with `:not([data-theme])` for OS-tracking,
 *    and once under `[data-theme='…']` for the user's forced choice. CSS gives
 *    no way to share one block between a media query and a plain selector, so
 *    the values are duplicated by necessity. Nothing except this test stops
 *    the two copies drifting, and a drifted copy is invisible until someone
 *    happens to be in the other mode.
 *
 * 2. CONTRAST. --text-on-accent is a single constant white, and the whole
 *    reason the fill ramp exists separately from the voice ramp is that fills
 *    are guaranteed to carry it. The stylesheet claims 4.5:1; this measures it.
 *
 * See docs/reference/design-system/design-language.md for the derivation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const STYLE = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../resources/styles/style.css'),
  'utf8',
);

/**
 * The surface palettes and the syntax palettes use identical selectors
 * (`:root:not([data-theme])` under a media query, `:root[data-theme='…']`
 * plain), and the syntax ones come first in the file. Everything below is
 * scoped to the theme section so a search cannot land on the wrong one.
 */
const THEME_SECTION = (() => {
  const start = STYLE.indexOf('/* ── Theme ──');
  if (start === -1) throw new Error('style.css has no "── Theme ──" section marker');
  return STYLE.slice(start);
})();

/**
 * Pull the declaration body of the first rule whose selector matches. The
 * pattern must end at the selector without consuming its `{`, so that a
 * media-scoped palette anchors on the inner `:root` rule rather than on the
 * `@media` wrapper.
 */
function block(startPattern: RegExp): string {
  const match = startPattern.exec(THEME_SECTION);
  if (!match) throw new Error(`no rule matching ${startPattern}`);
  let depth = 0;
  let i = THEME_SECTION.indexOf('{', match.index + match[0].length);
  const from = i + 1;
  for (; i < THEME_SECTION.length; i++) {
    if (THEME_SECTION[i] === '{') depth++;
    else if (THEME_SECTION[i] === '}' && --depth === 0) return THEME_SECTION.slice(from, i);
  }
  throw new Error(`unterminated rule for ${startPattern}`);
}

/** Custom-property declarations at the top level of a block. */
function tokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip nested rules so a `.settings-page { … }` inside the media query
  // does not leak its overrides into the palette being compared.
  const flat = css.replace(/[^{}]*\{[^{}]*\}/g, '');
  for (const m of flat.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].replace(/\s+/g, ' ').trim();
  }
  return out;
}

const PALETTES = [
  {
    mode: 'dark',
    tracking: /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)/,
    forced: /^:root\[data-theme='dark'\]\s*(?=\{)/m,
  },
  {
    mode: 'light',
    tracking: /@media \(prefers-color-scheme: light\)\s*\{\s*:root:not\(\[data-theme\]\)/,
    forced: /^:root\[data-theme='light'\]\s*(?=\{)/m,
  },
] as const;

describe.each(PALETTES)('$mode palette', ({ tracking, forced }) => {
  const osTracking = tokens(block(tracking));
  const userForced = tokens(block(forced));

  it('defines a non-trivial number of tokens in both copies', () => {
    expect(Object.keys(osTracking).length).toBeGreaterThan(20);
    expect(Object.keys(userForced).length).toBeGreaterThan(20);
  });

  it('defines the same token names in both copies', () => {
    expect(Object.keys(userForced).sort()).toEqual(Object.keys(osTracking).sort());
  });

  it('gives every token the same value in both copies', () => {
    for (const [name, value] of Object.entries(osTracking)) {
      expect(`${name}: ${userForced[name]}`).toBe(`${name}: ${value}`);
    }
  });
});

/* ── Contrast ───────────────────────────────────────────────────────────── */

function relativeLuminance(hex: string): number {
  const n = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const ON_ACCENT = /--text-on-accent:\s*(#[0-9a-f]{6})/i.exec(STYLE)?.[1] ?? '';

describe('the fill ramp carries --text-on-accent', () => {
  it('finds --text-on-accent as an opaque hex', () => {
    expect(ON_ACCENT).toMatch(/^#[0-9a-f]{6}$/i);
  });

  const fills = PALETTES.flatMap(({ mode, forced }) =>
    Object.entries(tokens(block(forced)))
      .filter(([name]) => name.endsWith('-fill'))
      .map(([name, value]) => ({ mode, name, value })),
  );

  it('has a fill for every state, in both palettes', () => {
    expect(fills).toHaveLength(8);
  });

  it.each(fills)('$mode $name is an opaque hex', ({ value }) => {
    // A translucent fill would composite against whatever is behind it, so the
    // contrast guarantee could not be checked here — or upheld at runtime.
    expect(value).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it.each(fills)('$mode $name reaches 4.5:1 against --text-on-accent', ({ value }) => {
    expect(contrast(value, ON_ACCENT)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the voice ramp stays distinct from the fill ramp', () => {
  // In light mode they legitimately converge: a colour dark enough to read as
  // text on paper already carries white. In dark mode they must not, because a
  // value bright enough to read on a dark ground cannot carry white text.
  const dark = tokens(block(PALETTES[0].forced));

  it.each(['primary', 'success', 'warning', 'danger'])(
    'dark --accent-%s differs from its fill',
    (state) => {
      expect(dark[`--accent-${state}`]).not.toBe(dark[`--accent-${state}-fill`]);
    },
  );

  it.each(['primary', 'success', 'warning', 'danger'])(
    'dark --accent-%s is the lighter of the pair',
    (state) => {
      const voice = relativeLuminance(dark[`--accent-${state}`]);
      const fill = relativeLuminance(dark[`--accent-${state}-fill`]);
      expect(voice).toBeGreaterThan(fill);
    },
  );
});
