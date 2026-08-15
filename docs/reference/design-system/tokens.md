# Asyar Design Tokens

CSS custom properties automatically injected into every extension iframe by the Asyar host. Use `var(--token-name)` in your CSS — no setup required.

**Theme changes are live.** When the user switches light/dark mode, the host re-injects updated values. Your extension adapts without a reload.

## During Development

When building outside the running app, import the static fallback file for IDE autocomplete and neutral defaults:

```typescript
import 'asyar-sdk/tokens.css';
```

Or in plain CSS:

```css
@import 'asyar-sdk/tokens.css';
```

Never hardcode colors, sizes, or radii. Using tokens ensures your extension adapts to light/dark mode and future theme changes automatically.

These tokens are the vocabulary of Asyar's design language, **Measure** — every
value derived from a constraint rather than chosen because it looked right. The
reasoning behind every value here is in
[Design Language](./design-language.md); this page is the lookup table.

## Token Reference

### Backgrounds

Surfaces and container fills.

Surfaces are deep navy rather than neutral grey, and translucent — an Asyar
surface lets the desktop read through it. Opacity rises with elevation: the
nearer a surface is, the less of the ground it lets past.

| Token                         | Dark default              | Use for                             |
| :---------------------------- | :------------------------ | :---------------------------------- |
| `--bg-primary`                | `rgba(14, 16, 28, 0.72)`  | Main panel/window background        |
| `--bg-secondary`              | `rgba(24, 27, 42, 0.7)`   | Cards, sidebars, secondary surfaces |
| `--bg-tertiary`               | `rgba(32, 36, 54, 0.7)`   | Input fields, subtle backgrounds    |
| `--bg-hover`                  | `rgba(56, 63, 92, 0.5)`   | Hover state on interactive elements |
| `--bg-selected`               | `rgba(61, 107, 245, .18)` | Active/selected state in lists      |
| `--bg-popup`                  | `rgb(16, 18, 31)`         | Opaque popups and modals            |
| `--bg-secondary-full-opacity` | `rgb(24, 27, 42)`         | bg-secondary without transparency   |

`--bg-selected` is the only surface token carrying chroma, and that is what
keeps selection distinct from hover at a glance. Keep `--bg-hover` neutral —
that difference is load-bearing, not stylistic.

The selected row is a **flat band**: `--bg-selected` plus a faint inset rim,
and nothing else. No gradient, no border, no accent seam.

```css
.card {
  background: var(--bg-secondary);
}
.input {
  background: var(--bg-tertiary);
}
.item:hover {
  background: var(--bg-hover);
}
.item.selected {
  background: var(--bg-selected);
}
```

### Text

| Token              | Dark default                | Use for                                                                                                                                                  |
| :----------------- | :-------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--text-primary`   | `rgba(237, 240, 252, 0.96)` | Headings, labels, primary content                                                                                                                        |
| `--text-secondary` | `rgba(196, 203, 227, 0.68)` | Subtitles, metadata, descriptions                                                                                                                        |
| `--text-tertiary`  | `rgba(170, 179, 209, 0.58)` | Placeholders, hints, disabled text                                                                                                                       |
| `--text-on-accent` | `#ffffff`                   | Text/icons **on** an `--accent-*-fill` surface. Constant across themes, and every fill is verified to carry it at 4.5:1, so never hardcode `#fff` for it |

```css
h2 {
  color: var(--text-primary);
}
p {
  color: var(--text-secondary);
}
::placeholder {
  color: var(--text-tertiary);
}
```

### Borders

| Token            | Dark default               | Use for                                           |
| :--------------- | :------------------------- | :------------------------------------------------ |
| `--border-color` | `rgba(140, 152, 200, .18)` | Borders on interactive elements (inputs, buttons) |
| `--separator`    | `rgba(140, 152, 200, .13)` | Dividers between list items and sections          |
| `--divider-soft` | `rgba(160, 172, 220, .06)` | The faintest hairline                             |
| `--rim-light`    | `rgba(255, 255, 255, .1)`  | Edge highlight, inside a shadow or gradient       |
| `--rim-shade`    | `rgba(0, 0, 0, 0.4)`       | Edge shade, same                                  |

**Prefer alignment to a border.** Two things sharing a left edge already read
as one column, and a border on top of that is a line the layout has already
drawn. Reach for `--border-color` when the job is genuinely "this is an
interactive control with an outline".

`--rim-light` and `--rim-shade` are ingredients rather than standalone
treatments — they appear inside `--shadow-launcher-popup` and the
filled-button gradients so a surface does not read as a flat rectangle of
colour.

**Every drop shadow casts straight down.** Height comes from blur and negative
spread, never from sliding the shadow sideways. Shadows that disagree about
direction read as a rendering mistake.

```css
.input {
  border: 1px solid var(--border-color);
}
.divider {
  border-top: 1px solid var(--separator);
}
```

### Accent

There are **two accent ramps**, and picking the wrong one is a contrast bug.

> **A colour that fills cannot also be the colour that speaks.**

An accent used as text on a dark surface must be light enough to read against
it. An accent used as a fill under white text must be dark enough for white to
read on top. On a dark ground those constraints have no common solution, so
Asyar ships both.

**The voice** — text, icons, strokes, focus rings, and the source for a tint:

| Token                  | Dark value      | Use for                                            |
| :--------------------- | :-------------- | :------------------------------------------------- |
| `--accent-primary`     | `#7B9CFF`       | Primary actions, focus rings, highlights           |
| `--accent-primary-rgb` | `123, 156, 255` | When you need rgba(var(--accent-primary-rgb), 0.2) |
| `--accent-success`     | `#3ED18F`       | Success states, confirmations                      |
| `--accent-warning`     | `#E9A83F`       | Warnings, caution states                           |
| `--accent-danger`      | `#FF6B77`       | Errors, destructive actions                        |

**The ground** — the background of a filled surface carrying `--text-on-accent`:

| Token                   | Dark value | Contrast with `--text-on-accent` |
| :---------------------- | :--------- | :------------------------------- |
| `--accent-primary-fill` | `#3D6BF5`  | 4.55:1                           |
| `--accent-success-fill` | `#0F7F58`  | 5.00:1                           |
| `--accent-warning-fill` | `#8F5D0A`  | 5.62:1                           |
| `--accent-danger-fill`  | `#C0303E`  | 5.62:1                           |

The test is mechanical: **does this surface have `--text-on-accent` on it?**
Yes → `-fill`. No → the voice.

```css
/* A filled button, a checked box, a coloured tile — carries white text */
.button-primary {
  background: var(--accent-primary-fill);
  color: var(--text-on-accent);
}

/* A status dot, a meter bar, an accent seam — carries no text */
.status-dot {
  background: var(--accent-success);
}

/* An accent label or link */
.link {
  color: var(--accent-primary);
}

/* A tinted state background — the house formula. Voice ramp for both, so
   the tint and the text always agree. */
.error-banner {
  background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
  color: var(--accent-danger);
}
```

Never use a `-fill` token as a text colour — it is too dark to read on an
Asyar surface.

### Brand

Brand and accent are one colour. Two identity colours is one more than the
product can spend. (Brand was a teal before this design system, while the
accent was Apple's system blue — so the app's most-used colour belonged to
Apple and the brand token was decorative.)

| Token                  | Dark value                  |
| :--------------------- | :-------------------------- |
| `--asyar-brand`        | `#7B9CFF`                   |
| `--asyar-brand-hover`  | `#9DB4FF`                   |
| `--asyar-brand-muted`  | `rgba(123, 156, 255, 0.18)` |
| `--asyar-brand-subtle` | `rgba(123, 156, 255, 0.09)` |

### Shadows

| Token            | Use for                                         |
| :--------------- | :---------------------------------------------- |
| `--shadow-xs`    | Subtle lift on small elements                   |
| `--shadow-sm`    | Cards, list items                               |
| `--shadow-md`    | Dropdowns, popovers                             |
| `--shadow-lg`    | Modals, elevated panels                         |
| `--shadow-xl`    | Large overlays                                  |
| `--shadow-popup` | Fixed popups and command palettes               |
| `--shadow-focus` | Focus ring (0 0 0 2px var(--asyar-brand-muted)) |

```css
.card {
  box-shadow: var(--shadow-sm);
}
.popup {
  box-shadow: var(--shadow-popup);
}
.focused {
  box-shadow: var(--shadow-focus);
}
```

### Border Radius

| Token           | Value    | Use for                  |
| :-------------- | :------- | :----------------------- |
| `--radius-xs`   | `4px`    | Tags, badges             |
| `--radius-sm`   | `6px`    | Buttons, inputs          |
| `--radius-md`   | `8px`    | Cards, panels            |
| `--radius-lg`   | `10px`   | Large containers         |
| `--radius-xl`   | `12px`   | Modals                   |
| `--radius-full` | `9999px` | Pills, circular elements |

```css
.button {
  border-radius: var(--radius-sm);
}
.card {
  border-radius: var(--radius-md);
}
.avatar {
  border-radius: var(--radius-full);
}
```

### Spacing

**A 2px grid** — not the 4px grid most systems use. At 40px rows and 11–14px
type, 4px is too coarse to tune a row against its neighbour. Space is the _gap
between_ things; for the dimensions _of_ things, use the size scale below.

| Token       | Value  | Token        | Value  |
| :---------- | :----- | :----------- | :----- |
| `--space-1` | `4px`  | `--space-7`  | `20px` |
| `--space-2` | `6px`  | `--space-8`  | `24px` |
| `--space-3` | `8px`  | `--space-9`  | `32px` |
| `--space-4` | `10px` | `--space-10` | `40px` |
| `--space-5` | `12px` | `--space-11` | `48px` |
| `--space-6` | `16px` |              |        |

`--space-0-5` (`2px`) is the smallest step and is a normal part of the scale.

**Four half-steps are deprecated — do not add new uses.** They are the only
off-grid values in the system, and they exist because the spacing scale was
being used as a sizing scale before `--size-*` existed: 23px was an icon tile,
11px a spinner, 13px a chip glyph.

| Deprecated    | Value  | Use instead                                                                                           |
| :------------ | :----- | :---------------------------------------------------------------------------------------------------- |
| `--space-1-5` | `5px`  | `--space-1` or `--space-2`                                                                            |
| `--space-2-5` | `11px` | `--space-4` or `--space-5`. Its name also misleads: it sits between `--space-4` and `-5`, not 2 and 3 |
| `--space-5-5` | `13px` | `--space-5` or `--space-6`                                                                            |
| `--space-7-5` | `23px` | `--space-8`, or `--size-lg` if it is an object                                                        |

### Size

**Space is the gap between objects; size is the object.** Use these for
widths, heights, icons, tiles and avatars rather than reaching into the
spacing scale. A 4px grid, so an object always lands on the spacing rhythm.

| Token        | Value  | Canonical use                             |
| :----------- | :----- | :---------------------------------------- |
| `--size-xs`  | `12px` | A glyph inside a dense chip or badge      |
| `--size-sm`  | `16px` | The default inline icon, beside body text |
| `--size-md`  | `20px` | A key chip, a small pill, a status pip    |
| `--size-lg`  | `24px` | The icon tile in a result row             |
| `--size-xl`  | `32px` | An extension avatar, a settings row icon  |
| `--size-2xl` | `48px` | An empty-state or onboarding glyph        |
| `--size-3xl` | `64px` | The largest object in the product         |

The names are t-shirt rather than role, so pick by value and treat the
canonical column as a guide — `--size-lg` on a spinner is fine; it is 24px,
not "a tile".

```css
.icon-tile {
  width: var(--size-lg);
  height: var(--size-lg);
}
.inline-icon {
  width: var(--size-sm);
  height: var(--size-sm);
}
```

```css
.item {
  padding: var(--space-3) var(--space-5);
}
.section {
  gap: var(--space-6);
}
```

### Font Sizes

| Token                 | Value     | Use for                                                                                      |
| :-------------------- | :-------- | :------------------------------------------------------------------------------------------- |
| `--font-size-2xs`     | `10px`    | Tiny labels                                                                                  |
| `--font-size-xs`      | `11px`    | Captions, section headers                                                                    |
| `--font-size-sm`      | `12px`    | Secondary text                                                                               |
| `--font-size-md`      | `13px`    | UI labels                                                                                    |
| `--font-size-base`    | `14px`    | Body text                                                                                    |
| `--font-size-lg`      | `15px`    | Subtitles                                                                                    |
| `--font-size-xl`      | `17px`    | Titles                                                                                       |
| `--font-size-2xl`     | `20px`    | Section headings                                                                             |
| `--font-size-3xl`     | `22px`    | Page headings                                                                                |
| `--font-size-section` | `16px`    | Section headings. Role-named because 16px falls between `lg` and `xl` with no free size name |
| `--font-size-display` | `2.25rem` | Hero / display text                                                                          |

The dense band is a modular scale — `10 × 1.08ⁿ`, rounded — which reproduces
10, 11, 12, 13, 14, 15, 16 and 17 exactly. A 1.08 ratio is unusually tight;
it is right for Asyar because 65% of all type in the product sits between 11px
and 13px, and a coarser ratio would leave the app with three usable sizes.
Above 17px the ratio breaks deliberately: 20px is the command line, 22px a page
title, 36px display type, and nothing else belongs there.

### Font Families

| Token         | Fonts                   | Use for                  |
| :------------ | :---------------------- | :----------------------- |
| `--font-ui`   | `Satoshi, system-ui, …` | All UI text              |
| `--font-mono` | `JetBrains Mono, …`     | Code, monospaced content |

The host injects the actual Satoshi and JetBrains Mono font files into every extension iframe as base64 data URIs on load. `var(--font-ui)` and `var(--font-mono)` render the real typefaces — not system fallbacks — with no extra setup.

Satoshi renders on **every** platform, macOS included. Asyar deliberately does
not fall back to the system face anywhere.

```css
body {
  font-family: var(--font-ui);
}
code {
  font-family: var(--font-mono);
}
```

### Tracking

Pair with the font sizes above. Never set `letter-spacing` from a raw `em`
value — Satoshi is drawn a little wide for dense UI, so display sizes are
pulled tight and small text is left alone.

| Token                | Value      | Use for                                  |
| :------------------- | :--------- | :--------------------------------------- |
| `--tracking-display` | `-0.028em` | Page titles, the largest type in the app |
| `--tracking-tight`   | `-0.014em` | The command line, section headings       |
| `--tracking-normal`  | `0em`      | All body, label and caption text         |
| `--tracking-wide`    | `0.06em`   | Uppercase group labels only              |

Weight discipline: **500 is the heaviest weight for body and label text**, 600
is for headings, and 700 does not appear in the product.

### Motion

Four durations and four curves. Every animation in Asyar is one of each; there
is no fifth of either.

| Token           | Value   | Use for                                  |
| :-------------- | :------ | :--------------------------------------- |
| `--dur-instant` | `80ms`  | Colour/opacity landing under the pointer |
| `--dur-quick`   | `140ms` | A state change the user caused directly  |
| `--dur-travel`  | `220ms` | The selection moving; a panel sliding    |
| `--dur-emerge`  | `320ms` | The launcher arriving; a sheet opening   |

| Token           | Value                            | Character                                      |
| :-------------- | :------------------------------- | :--------------------------------------------- |
| `--ease-travel` | `cubic-bezier(.32, .72, 0, 1)`   | The default. Fast out, long settle.            |
| `--ease-emerge` | `cubic-bezier(.16, 1, .3, 1)`    | Something arriving                             |
| `--ease-recede` | `cubic-bezier(.7, 0, .84, 0)`    | Something leaving                              |
| `--ease-settle` | `cubic-bezier(.34, 1.4, .64, 1)` | **Scale only.** The one curve that overshoots. |

Arrival and departure use _different_ curves — using one for both is the
fastest way to make an interface feel cheap. And `--ease-settle` may only be
applied to `scale`: overshoot on position reads as sloppy, on opacity it is
incoherent.

Before adding any animation, ask: **if this were removed, would the user be
confused about what happened?** If no, don't add it.

```css
.button {
  transition: background var(--dur-quick) var(--ease-travel);
}
.panel {
  transition: transform var(--dur-travel) var(--ease-travel);
}
.tile:active {
  transition: transform var(--dur-instant) var(--ease-settle);
}
```

Reduced motion is handled globally by the host; you do not need a
`prefers-reduced-motion` block unless your view animates via JavaScript.

### Transitions (shorthands)

Kept as convenience shorthands over the motion tokens above.

| Token                 | Value                                   |
| :-------------------- | :-------------------------------------- |
| `--transition-fast`   | `var(--dur-instant) var(--ease-travel)` |
| `--transition-normal` | `var(--dur-quick) var(--ease-travel)`   |
| `--transition-smooth` | `var(--dur-travel) var(--ease-travel)`  |
| `--transition-slow`   | `var(--dur-emerge) var(--ease-emerge)`  |

### Code Colour

Use these for anything syntax-highlighted, so a snippet in your extension
matches one rendered by the host.

| Token               | Dark default | Use for                                 |
| :------------------ | :----------- | :-------------------------------------- |
| `--syntax-comment`  | `#637777`    | Comments                                |
| `--syntax-keyword`  | `#c792ea`    | Keywords, at-rules, booleans            |
| `--syntax-string`   | `#c3e88d`    | Strings, attribute names, inserted text |
| `--syntax-number`   | `#f07178`    | Numbers, properties, tags, constants    |
| `--syntax-function` | `#82aaff`    | Function and class names, object keys   |

### Controls

| Token            | Dark default | Use for                                                                          |
| :--------------- | :----------- | :------------------------------------------------------------------------------- |
| `--control-knob` | `#ffffff`    | The moving part of a switch. White in both themes, like a native platform toggle |

## Complete Example

A realistic card component using only design tokens:

```html
<div class="card">
  <div class="card-header">
    <span class="title">Item Title</span>
    <span class="badge">New</span>
  </div>
  <p class="description">Supporting description text.</p>
</div>

<style>
  .card {
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    padding: var(--space-6);
    font-family: var(--font-ui);

    /* An edge highlight instead of a border, layered with the elevation
       shadow — which, like every drop shadow here, casts straight down. */
    box-shadow:
      inset 0 1px 0 0 var(--rim-light),
      var(--shadow-sm);
    transition: box-shadow var(--dur-quick) var(--ease-travel);
  }
  .card:hover {
    box-shadow:
      inset 0 1px 0 0 var(--rim-light),
      var(--shadow-md);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .title {
    color: var(--text-primary);
    font-size: var(--font-size-base);
  }

  .badge {
    background: var(--asyar-brand-muted);
    color: var(--asyar-brand);
    font-size: var(--font-size-xs);
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-full);
  }

  .description {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
</style>
```
