---
name: design-language
description: Use when building, modifying, or fixing any frontend UI in the Asyar launcher — new components, new views, layout changes, styling decisions, new built-in features, visual bug fixes, and anything in settings or onboarding. Answers "what do I use here?" for fonts, colour, typography, spacing, motion, components, and layout.
---

# Asyar Design Language — Directed Light

This file answers one question: **given what you are building, what do you use?**

Every table below is a lookup. Find your row, use what it says. If your case
is not in a table, the answer is at the bottom under
[When nothing fits](#when-nothing-fits) — it is never "invent something".

The reasoning behind all of this lives in
[`docs/reference/design-system/design-language.md`](../../../docs/reference/design-system/design-language.md).
Read that once. Work from this.

**`pnpm check:design` enforces the mechanical half and runs in CI.** If it
passes, you have not broken the system; it does not mean your UI is good. The
judgement calls are the tables.

---

## The thesis, in one paragraph

Asyar is **an instrument, not a place**. It is summoned by a keystroke, lives
for two to six seconds, and vanishes. Its design language is derived from its
own app icon: one light source, directly above, lighting exactly one thing.
Four principles fall out of that, and every table below is one of them made
operational:

1. **One Lit Thing** — exactly one element carries full luminance and chroma.
2. **The Ground Shows Through** — surfaces are translucent and tinted, never
   opaque neutral cards.
3. **Every Affordance Names Its Key** — if it can be done, its key is visible.
4. **Motion Reports** — if removing an animation wouldn't confuse anyone,
   remove it.

When two rules below seem to conflict, the principle wins, and **Principle I
wins over all the others.**

---

## The 30-second version

| You need                      | You use                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| Any UI element                | A component from `src/components/index.ts` — read the barrel first                       |
| Any colour                    | A `var(--…)` token. Never a hex, `rgb()`, `white`, or a Tailwind colour                  |
| Any accent **as text/icon**   | `var(--accent-*)` — the voice ramp                                                       |
| Any accent **as a fill**      | `var(--accent-*-fill)` — the ground ramp. See [§2](#2-colour)                            |
| Any text size or weight       | A `.text-*` class, or `var(--font-size-*)`                                               |
| Any letter-spacing            | `var(--tracking-*)` — never a raw `em`                                                   |
| Any padding/margin/gap        | `var(--space-*)` — the gap between things                                                |
| Any width/height/icon size    | `var(--size-*)` — the thing itself. See [§5](#5-space-and-size--which-measurement-where) |
| A shell metric                | `--shell-header-h` · `--shell-footer-h` · `--shell-row-h`                                |
| Any corner                    | `var(--radius-*)`                                                                        |
| Any duration                  | `var(--dur-*)`                                                                           |
| Any easing                    | `var(--ease-*)`                                                                          |
| Any stacking                  | `var(--z-*)`                                                                             |
| A raised surface's top edge   | `.rim`, or `inset 0 1px 0 0 var(--rim-light)`                                            |
| A selected row                | `.bloom`, or let `.list-row.selected` do it                                              |
| A scrolling container         | Add `.custom-scrollbar`                                                                  |
| Something that does not exist | Build a reusable component in `src/components/`, export it from the barrel               |

Never write a `var(--token, fallback)`. Every token is always defined, so a
fallback can only ever hide a typo — that is exactly how a whole subsystem in
this app once ended up running on invented token names nobody noticed.

---

## 1. Fonts — which font, where

Two faces. There is no third.

| Where                                                                               | Token              | Renders as     |
| ----------------------------------------------------------------------------------- | ------------------ | -------------- |
| All UI text — labels, titles, body, buttons, menus, settings, onboarding            | `var(--font-ui)`   | Satoshi        |
| Code, JSON, file paths, IDs, hashes, shortcuts, timestamps, anything column-aligned | `var(--font-mono)` | JetBrains Mono |

- `--font-ui` is applied globally to `*`. You only name it explicitly inside a
  component that also sets `font-family` for another reason.
- **Satoshi renders on every platform, macOS included.** There is deliberately
  no per-platform override. Asyar used to fall back to San Francisco on macOS;
  that gave the app no typographic identity on its primary platform. Do not
  reintroduce it.
- Reach for mono when characters need to line up or be read individually. A
  duration, a count, or a version number in prose stays in `--font-ui`; the
  same value in a table column goes mono. `.text-mono` already carries
  `tabular-nums`.

### Tracking

| Token                | Where                                     |
| -------------------- | ----------------------------------------- |
| `--tracking-display` | Page titles — the largest type in the app |
| `--tracking-tight`   | The command line, section headings        |
| `--tracking-normal`  | All body, label and caption text          |
| `--tracking-wide`    | Uppercase group labels only               |

Never write a raw `letter-spacing: -0.02em`. The `.text-*` classes already
carry the right value, which is the main reason to use them.

---

## 2. Colour

### The one rule people get wrong

> **A colour that fills cannot also be the colour that speaks.**

There are two accent ramps, and picking the wrong one is a contrast bug that
looks fine to you and is unreadable to someone else.

| Ramp           | Token             | Use for                                                               |
| -------------- | ----------------- | --------------------------------------------------------------------- |
| **The voice**  | `--accent-*`      | Text, icons, strokes, focus rings, borders, and the source for a tint |
| **The ground** | `--accent-*-fill` | The background of a filled surface that carries `--text-on-accent`    |

The test is mechanical: **does this surface have `--text-on-accent` (or
`--control-knob`) on top of it?** Yes → `-fill`. No → the voice.

```css
/* A filled button, a checked checkbox, a user chat bubble, a coloured tile */
background: var(--accent-primary-fill);
color: var(--text-on-accent);

/* A status dot, a meter bar, a progress fill, a left accent seam — no text */
background: var(--accent-primary);

/* An accent-coloured label, a link, an icon */
color: var(--accent-primary);
```

`check:design` fails the build on a voice token used as a background in the
same rule as `--text-on-accent` (`voice-as-fill`). It cannot catch the inverse,
so: **never use a `-fill` token as a text colour** — it is too dark to read on
an Asyar surface.

### Surfaces, from back to front

| Token              | Use for                                                      |
| ------------------ | ------------------------------------------------------------ |
| `--bg-primary`     | The window background. You rarely set this yourself          |
| `--bg-secondary`   | Cards, sidebars, panels — anything sitting on the window     |
| `--bg-tertiary`    | Inputs, wells, and subtle insets inside a card               |
| `--bg-hover`       | Hover on any interactive row, button, or tile                |
| `--bg-selected`    | The selected row — accent-tinted, this is the Bloom          |
| `--bg-popup`       | Opaque popups and menus                                      |
| `--surface-canvas` | Only where external HTML assumes a white page (URL previews) |

Never set an opaque background on the root container — platform overrides
(macOS transparency, Windows Acrylic, opaque Linux) handle that automatically.
**Elevation is a scalar, not a stack:** a popup opened from a card is still
one popup, not a card plus a popup. If you want a fourth level, what you
actually want is `--scrim` to push the thing beneath it back.

### Text

| Token              | Use for                                         |
| ------------------ | ----------------------------------------------- |
| `--text-primary`   | Headings, labels, the content the user came for |
| `--text-secondary` | Subtitles, metadata, supporting detail          |
| `--text-tertiary`  | Placeholders, hints, disabled text, timestamps  |
| `--text-on-accent` | Text or icons on any `--accent-*-fill` surface  |

Three tiers. If you want a fourth, you want a different layout.

### Colour is never the only channel

**Every state must be legible with all hue removed.** Simulated for
deuteranopia (~6% of men) the three state colours collapse toward the same
olive — success against danger sits at a luminance ratio of 1.23. No contrast
tuning fixes that, because the problem is hue discrimination.

So a state colour is an accelerant on top of a shape, an icon, or a word, never
the sole carrier. A status indicator needs a label or an adjacent word; a
severity needs an icon with a different silhouette. `Badge` is fine — it carries
text. A bare coloured dot is not.

Review test: **screenshot it, desaturate it, and see if you can still read the
state.**

### Semantic state

| Token              | Means                                                                              |
| ------------------ | ---------------------------------------------------------------------------------- |
| `--accent-primary` | Primary action, focus, selection, links                                            |
| `--accent-success` | Succeeded, healthy, connected                                                      |
| `--accent-warning` | Needs attention, degraded, in progress                                             |
| `--accent-danger`  | Destructive action, error, failed                                                  |
| `--asyar-brand`    | Asyar's identity. Now the same blue as the accent — brand and accent are one light |

For a **tinted background** in a state colour, mix it rather than inventing a
second token — this is the house formula, and it uses the voice ramp for both
the tint and the text so they always agree:

```css
background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
color: var(--accent-danger);
```

### Lines, edges and light

| Token            | Use for                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `--border-color` | The border of an interactive element                                  |
| `--separator`    | List dividers, section rules, subtle outlines                         |
| `--divider-soft` | The faintest hairline (split-view handle)                             |
| `--rim-light`    | The top edge of a raised surface — see [§4](#4-elevation-and-the-rim) |
| `--rim-shade`    | The bottom edge of a raised surface                                   |

**Prefer a rim to a border** when the job is "this surface is closer to the
light than what's behind it". Use a real border when the job is "this is an
interactive control with an outline".

### Code colour

Only for rendered code and structured data. The Prism markdown theme and
`JsonTree` both read from these, so a snippet looks the same everywhere.

`--syntax-comment` · `--syntax-keyword` · `--syntax-string` · `--syntax-number` · `--syntax-function`

### Everything else

`--scrim` / `--scrim-opaque` for modal backdrops · `--control-knob` for the
Toggle knob · `--shadow-color` inside shadows only · `--kbd-rim` for key chips.

---

## 3. Typography — which class, where

Use the class. Only drop to raw `var(--font-size-*)` inside a component that
needs a size the classes do not cover.

| Where you are                                      | Class              |
| -------------------------------------------------- | ------------------ |
| The title of a settings page or a full-screen view | `.text-page-title` |
| A section heading inside a page                    | `.text-section`    |
| An uppercase group label above a list              | `.section-header`  |
| The name of a list item, card, or result           | `.text-title`      |
| A paragraph of running text                        | `.text-body`       |
| The label on a form field or setting               | `.text-label`      |
| The second line under a list-item title            | `.text-subtitle`   |
| A hint, a timestamp, a caption                     | `.text-caption`    |
| Code, a path, an ID                                | `.text-mono`       |

Weight rules: **500 (`font-medium`) is the heaviest weight for body and label
text.** 600 (`font-semibold`) is for headings and the command line. **700 does
not appear in the product** — at display sizes with display tracking, 600 is
already maximally emphatic and 700 reads as shouting. Never `font-bold`.

**The command line is the largest text in the app and nothing may match it.**
If you are adding something at `--font-size-2xl` or above outside
`SearchHeader`, you are competing with the query. Don't.

---

## 4. Elevation and the Rim

**One light source, directly above.** This is the rule that makes the whole
system cohere:

> **No shadow in Asyar has a horizontal offset.** Every shadow is `0 Ypx`.

Height comes from blur radius and negative spread, never from sliding the
shadow sideways — a sideways shadow implies a second light source.

| Token                     | For                                    |
| ------------------------- | -------------------------------------- |
| `--shadow-xs` … `-xl`     | Lift, in five steps                    |
| `--shadow-popup`          | Menus                                  |
| `--shadow-launcher-popup` | The launcher's floating surfaces       |
| `--shadow-focus`          | Focus rings (applied globally already) |

Compose the top-edge highlight with `.rim`, or `.rim-all` for a highlight plus
a bottom shade. Both are one inset shadow and cost nothing.

**Radius** — `--radius-xs` (4) · `sm` (6) · `md` (8) · `lg` (10) · `xl` (12) ·
`popup` (20) · `full`. Small controls take `sm`, cards take `md`, modals take
`xl`, floating launcher surfaces take `popup`.

**Stacking** — never a bare number:

| Token          | Value | For                                                 |
| -------------- | ----- | --------------------------------------------------- |
| `--z-base`     | 1     | Stacking inside one card or row                     |
| `--z-raised`   | 10    | An icon or handle over its own container            |
| `--z-footer`   | 40    | The launcher bottom bars                            |
| `--z-dropdown` | 50    | A list anchored to a field or row                   |
| `--z-floating` | 60    | Toasts, search accessories — above dropdowns        |
| `--z-header`   | 100   | The launcher search header                          |
| `--z-overlay`  | 200   | Prompts, banners, the extension inspector           |
| `--z-portal`   | 9999  | A fixed popup escaping an `overflow: hidden` parent |

`Modal` uses native `<dialog>`, which renders in the browser's top layer and is
above all of these regardless of z-index. You never need to out-number a modal.

---

## 5. Space and size — which measurement, where

**Space is the gap between objects. Size is the object.** Two scales, and
reaching into the wrong one is how `--space-*` ended up with values like 11px
and 23px — those were an icon tile and a spinner, not rhythm.

| You are setting                           | You use          |
| ----------------------------------------- | ---------------- |
| padding, margin, gap, inset               | `var(--space-*)` |
| width, height, an icon, a tile, an avatar | `var(--size-*)`  |

### Space — a 2px grid

`var(--space-N)`, from `--space-0-5` (2px) to `--space-11` (48px). Whole steps
only:

`2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 · 24 · 32 · 40 · 48`

**Four tokens are deprecated. Do not add new uses of them** — they are the only
off-grid values in the system, and they exist because sizes had no scale:

| Deprecated    | Value | Use instead                                    |
| ------------- | ----- | ---------------------------------------------- |
| `--space-1-5` | 5px   | `--space-1` or `--space-2`                     |
| `--space-2-5` | 11px  | `--space-4` or `--space-5`                     |
| `--space-5-5` | 13px  | `--space-5` or `--space-6`                     |
| `--space-7-5` | 23px  | `--space-8`, or `--size-lg` if it is an object |

### Size — a 4px grid

| Token        | Value | Canonical use                             |
| ------------ | ----- | ----------------------------------------- |
| `--size-xs`  | 12px  | A glyph inside a dense chip or badge      |
| `--size-sm`  | 16px  | The default inline icon, beside body text |
| `--size-md`  | 20px  | A key chip, a small pill, a status pip    |
| `--size-lg`  | 24px  | The icon tile in a result row             |
| `--size-xl`  | 32px  | An extension avatar, a settings row icon  |
| `--size-2xl` | 48px  | An empty-state or onboarding glyph        |
| `--size-3xl` | 64px  | The largest object in the product         |

The names are t-shirt, not role, so pick by value and use the canonical column
as a guide. `--size-lg` on a spinner is fine; it is 24px, not "a tile".

### The nine-row fit — do not break this by accident

The launcher's content area is 384px, the list insets it by `--space-3` top and
bottom, and **368px is exactly nine rows**: `9 × 40 + 8 × 1`.

- The row height is `var(--shell-row-h)` (40px). Changing it changes how much
  of Asyar is visible at once.
- Row separation is a raw `1px`, **not** `--space-0-5`. Two pixels overflows
  368 and costs a whole row. This is the one place a raw pixel beats a token.
- Never hardcode `56px`, `40px` or `384px`. Use `--shell-header-h`,
  `--shell-footer-h`, `--shell-row-h`, or `calc()` off them.

### Density — how fast is this read?

The tokens are identical across all five surfaces; the rhythm is not.

| Surface        | Rhythm                                              | Read at                          |
| -------------- | --------------------------------------------------- | -------------------------------- |
| **Launcher**   | `--space-2` / `--space-3` inside a row              | A glance. Density is the feature |
| **Settings**   | `--space-5` / `--space-6` between rows and sections | Deliberately, with a pointer     |
| **Onboarding** | `--space-7`+ between blocks                         | Once, slowly. One idea per stage |

If you are unsure how much space to use, the question is not "what looks right"
but **"how fast is this read?"**

Pointer targets: the launcher's 40px row is below the 44px guideline, which is
an accepted trade for the ninth result on a keyboard-first surface. Nothing
that is _not_ keyboard-first gets that excuse — Settings and onboarding use the
roomier density above.

---

## 6. Motion

Four durations, four curves. Every animation is one of each. **There is no
fifth of either** — adding one is a change to the design language, not to your
component.

| Duration        | Use for                                  |
| --------------- | ---------------------------------------- |
| `--dur-instant` | Colour/opacity landing under the pointer |
| `--dur-quick`   | A state change the user caused directly  |
| `--dur-travel`  | The selection moving; a panel sliding    |
| `--dur-emerge`  | The launcher arriving; a sheet opening   |

| Curve           | Use for                                              |
| --------------- | ---------------------------------------------------- |
| `--ease-travel` | The default. Almost everything.                      |
| `--ease-emerge` | Something arriving                                   |
| `--ease-recede` | Something leaving                                    |
| `--ease-settle` | **Scale only.** The only curve allowed to overshoot. |

Rules that are not negotiable:

- **Arrival and departure use different curves.** One curve for both is the
  fastest way to make an interface feel cheap.
- **`--ease-settle` may only be applied to `scale`.** Overshoot on position
  reads as sloppy; on opacity it is incoherent.
- **Before adding any animation, ask: if this were removed, would the user be
  confused about what happened?** If no, don't add it.
- Reduced motion is handled globally in `style.css`. You do not need a
  `prefers-reduced-motion` block unless your component animates via JS.

`--transition-fast/normal/smooth/slow` still exist and still work; they are
shorthands over the tokens above. New code should pair a duration with a curve
directly.

---

## 7. Voice — how it reads

Asyar is mostly words, and it writes the way an instrument reports: flatly, in
the user's terms, without personality.

| Rule                                | Do                                              | Not                           |
| ----------------------------------- | ----------------------------------------------- | ----------------------------- |
| Sentence case, always               | "Copy to clipboard"                             | "Copy To Clipboard"           |
| A control names its result          | "Publish" → toast "Published"                   | "OK" · "Submit"               |
| Name what the user recognises       | "Notifications"                                 | "Webhook config"              |
| Errors say what broke and what next | "Extension failed to load — check the manifest" | "An error occurred"           |
| No apology, no exclamation          | "Nothing matched 'xyz'"                         | "Sorry! Nothing found!"       |
| Second person, active               | "Choose a shortcut"                             | "A shortcut should be chosen" |

- **A result is named, never described.** Title = what it is called. Subtitle =
  where it lives or what it does. Neither is a sentence.
- **Truncate at the end**, except file paths, where the middle goes.
- Fixed terms, not synonyms: a **command** is declared by an extension; an
  **action** is what you can do to a selected result; a **result** is a row; an
  **extension** ships them.

---

## 8. Components — which component, where

**Read `src/components/index.ts` before deciding anything does not exist.** It
exports every component in the app except `ConfirmDialog` and the extension
inspector's internals, both documented at the bottom of that file. The checker
fails the build if a component is missing from it, so the barrel is trustworthy
— treat it as the catalogue.

### By what you are building

| You are building                      | Use                                                    |
| ------------------------------------- | ------------------------------------------------------ |
| A button                              | `Button` — never a styled `<button>`                   |
| An icon-only button                   | `IconButton`                                           |
| A button in the launcher's bottom bar | `BottomBarButton`                                      |
| A text field                          | `Input` · multi-line: `Textarea`                       |
| A dropdown of fixed options           | `Select`                                               |
| An on/off setting                     | `Toggle` · in a list of choices: `Checkbox`            |
| Two-to-four exclusive options, inline | `SegmentedControl`                                     |
| Top-level navigation between views    | `TabGroup` (`pills` or `sidebar`)                      |
| A keyboard shortcut, displayed        | `KeyboardHint`                                         |
| A keyboard shortcut, being recorded   | `ShortcutRecorder`                                     |
| A status word (`ready`, `failed`)     | `Badge` — variants default/success/warning/danger/info |
| A status dot                          | `StatusDot`                                            |
| A progress or capacity bar            | `MeterBar`                                             |
| A single headline number              | `StatTile`                                             |
| A busy indicator                      | `Spinner` (`inline` beside text, `md` standalone)      |
| An icon                               | `Icon` · in a sized container: `IconBox`               |
| An extension's avatar                 | `ExtensionAvatar`                                      |

| You are building                              | Use                             |
| --------------------------------------------- | ------------------------------- |
| **Any** dialog                                | `Modal`                         |
| A yes/no confirmation                         | Queue it through `DialogHost`   |
| A destructive confirmation                    | Same, with the `danger` variant |
| A row in a list                               | `ListItem`                      |
| A long, scrolling result list                 | `ResultsList` (virtualised)     |
| A list with group headers                     | `SectionedResultsList`          |
| A resizable two-pane layout                   | `SplitView`                     |
| A master/detail page with its own empty state | `SplitListDetail`               |
| A card                                        | `Card`                          |
| A page header with a back button              | `AppBar`                        |
| Actions pinned to the bottom of a view        | `ActionFooter`                  |
| A ⌘K-style action menu                        | `ActionListPopup`               |

| You are building                              | Use                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| "There is nothing here"                       | `EmptyState`                                                                            |
| …inside a panel that is part of a fuller view | `EmptyState` with `compact`                                                             |
| …that doubles as "add the first one"          | `EmptyState` with `compact bordered` + a `Button`                                       |
| "This is loading"                             | `LoadingState`                                                                          |
| "This failed"                                 | `ErrorState` · inside a form: `InlineError`                                             |
| A non-blocking caution                        | `WarningBanner`                                                                         |
| A transient confirmation                      | Publish via `feedbackService` — `ToastHost` is already mounted and must not be imported |

| You are building                          | Use                                          |
| ----------------------------------------- | -------------------------------------------- |
| A settings page                           | `SettingsForm` + `SettingsSection`           |
| One setting with a label and a control    | `SettingsRow` · in a form: `SettingsFormRow` |
| A set of radio choices in settings        | `SettingsRadioGroup`                         |
| A numeric slider in settings              | `SettingsRangeSlider`                        |
| A labelled form field with hint and error | `FormField`                                  |
| An onboarding step                        | `OnboardingStage` + `GuidanceStep`           |
| Onboarding progress                       | `StepProgress`                               |
| A "try it now" box in onboarding          | `TestBox`                                    |

If two components look like they both fit, pick the more specific one.

---

## 9. Layout

### The launcher shell

```
┌───────────────────────────────────┐
│  SearchHeader   .search-header    │  fixed, --shell-header-h, --z-header
├───────────────────────────────────┤
│                                   │
│  .shell-content custom-scrollbar  │  fixed between the two bars, scrolls
│                                   │
├───────────────────────────────────┤
│  BottomActionBar                  │  fixed, --shell-footer-h, --z-footer
└───────────────────────────────────┘
```

- The header and footer are **already mounted** by `routes/+page.svelte`. A
  view renders into the content area only.
- **Never add a second fixed header or footer inside a view.**
- Never hardcode `56px` or `40px`. Use `--shell-header-h` /
  `--shell-footer-h`, or `calc()` off them, so the five places that depend on
  those heights stay in agreement.
- For a master/detail view inside the content area, use `SplitListDetail` (or
  `SplitView` for a plain resizable split) — not a hand-rolled flex layout.

### Scrolling

Every scrolling container gets `.custom-scrollbar`. No exceptions — the
checker enforces it, because the platform default scrollbar against Asyar's
surfaces is immediately obvious.

### The five surfaces

The tokens and components are identical across all three. What differs is
density and how much chrome is acceptable.

| Surface        | Density                                                    | Notes                                                                                                                  |
| -------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Launcher**   | Tightest. `--space-2`/`--space-3` inside rows              | Keyboard-first: every action needs a key path and a `KeyboardHint`. Chrome stays invisible                             |
| **Settings**   | Roomier. `--space-5`/`--space-6` between rows and sections | Always `SettingsSection` → `SettingsRow`. Mouse and keyboard are equal citizens                                        |
| **Onboarding** | Roomiest. `--space-7`+ between blocks                      | One idea per stage. `OnboardingStage` owns the frame; a step supplies content, never its own layout                    |
| **HUD**        | A single line, no chrome                                   | Read peripherally, mid-task. It is a standalone webview with no theme injection — the one `design-ok-file` in the repo |
| **Sticky**     | Launcher density, but persistent                           | Read repeatedly over minutes, so it takes hover states the launcher does not need                                      |

---

## 10. Interaction and accessibility

Every interactive element covers every state:

| State            | Pattern                                                |
| ---------------- | ------------------------------------------------------ |
| Hover            | `background: var(--bg-hover)`                          |
| Active / pressed | `.pressable`, or `background: var(--bg-selected)`      |
| Keyboard focus   | Nothing — the global `*:focus-visible` ring handles it |
| Disabled         | `opacity: 0.5; cursor: not-allowed`                    |
| Selected in list | `.bloom`, or let `.list-row.selected` do it            |

**Hover must never be mistakable for selection** (Principle I). `--bg-hover`
is neutral; `--bg-selected` carries chroma. That difference is load-bearing —
do not "improve" hover by tinting it.

**A selected row never takes a border.** The Bloom's left seam is the edge.

**Focus is already solved globally.** `*:focus-visible` applies
`var(--shadow-focus)` app-wide. Two things break it, both worth knowing:

1. A more specific rule that also sets `box-shadow` (e.g. `.item.active`)
   silently wins. If your component sets `box-shadow` in any state — and the
   Rim is a `box-shadow` — restate the ring in a `:focus-visible` rule
   **after** it.
2. `:focus-within` does not match when the real input is a _sibling_ rather
   than a descendant. Drive the ring off the input with
   `:global(.peer:focus-visible) ~ .track`.

Use `:focus-visible`, not `:focus`, for buttons and rows — `:focus` also fires
on mouse click. Text fields are the exception: they legitimately use `:focus`,
and the global rule already stands aside for `input`/`textarea`/`select`.

Other rules:

- Anything clickable is a `<button>` or `<a>`. A `<div onclick>` needs a
  `role`, a `tabindex`, and a key handler — and is almost always the wrong
  answer.
- `svelte-ignore` uses **underscores** in Svelte 5
  (`a11y_no_static_element_interactions`). The Svelte 4 hyphenated names
  silently suppress nothing.
- Decorative icons get `aria-hidden="true"`; meaningful ones get a label.

---

## 11. Third-party extensions (Tier 2, iframe sandbox)

Extensions run in two sandboxed iframes — a hidden worker and an on-demand
view. Design rules apply to the **view**.

- Every CSS token above is injected automatically, along with the real Satoshi
  and JetBrains Mono files. `var(--bg-primary)`, `var(--font-ui)` etc. just
  work. **The same "never hardcode a colour" rule applies**, and so does the
  voice/fill split.
- Icons come from the `<asyar-icon>` web component: call `registerIconElement()`
  once in the view entry, then `<asyar-icon name="calculator" size="20">`.
  Icons inherit `currentColor`.
- There is **no bare `asyar-sdk` entry point** — import from `asyar-sdk/view`,
  `asyar-sdk/worker`, or `asyar-sdk/contracts`. The icon helpers are
  DOM-dependent and ship on `/view` only.
- For IDE autocomplete outside the running app, import `asyar-sdk/tokens.css`.

A **theme** extension may override colour, shadow, radius, font family and
duration tokens. It may **not** override `--space-*`, `--font-size-*`,
`--tracking-*` or `--ease-*` — those are design-system-owned, and
`applyTheme` filters them out. A theme recolours the app; it never resizes or
re-times it.

---

## 12. When nothing fits

In order. Do not skip a step.

1. **Re-read the barrel.** `src/components/index.ts` exports ~100 components.
   The thing you want usually exists under a name you did not guess.
2. **Check whether an existing component takes a prop for it.** `EmptyState`
   grew `compact` and `bordered` this way; `Badge` already has five variants.
   Extending beats duplicating.
3. **Build a new reusable component** in `src/components/{category}/`, style it
   with tokens, export it from the barrel, and use it. If it is worth building,
   it is worth making reusable.
4. **A token genuinely missing?** Add it to `:root` in
   `resources/styles/style.css` with a comment saying what it is for, and give
   it a light and dark value if it is not constant. If it is a colour that
   belongs to a palette, add it to **both copies** of that palette —
   `themePalettes.test.ts` will fail if you add it to only one. Then add it to
   `THEME_VAR_NAMES` in `lib/themeVariables.ts` so extension iframes get it.

### The escape hatch

Some values legitimately are not on a scale: a glyph sized to a fixed tile, a
metric pinned to a native platform dimension, a standalone webview with no
theme injection. For those, and only those:

```css
/* design-ok: glyph scaled to the fixed 128px box, not UI text */
font-size: 64px;
```

A reason is required — a bare `design-ok` does not suppress. For a whole file
(there is currently exactly one, the HUD window), use `design-ok-file: <reason>`.

If you find yourself writing the third `design-ok` for the same kind of value,
that is the system telling you a token is missing. Add the token instead.

---

## 13. Before you call it done

Run `pnpm check:design`. It fails on:

| Rule                   | What it catches                                                          |
| ---------------------- | ------------------------------------------------------------------------ |
| `undefined-token`      | `var(--x)` where `--x` is defined nowhere — the declaration is dead      |
| `token-fallback`       | `var(--x, something)`                                                    |
| `hardcoded-color`      | A hex, `rgb()`, `white` or `black` in a colour property                  |
| `voice-as-fill`        | `--accent-*` as a background under `--text-on-accent`                    |
| `space-as-size`        | `--space-*` on a width or height where a `--size-*` holds the same value |
| `deprecated-token`     | A new use of `--space-1-5`/`-2-5`/`-5-5`/`-7-5`                          |
| `tailwind-palette`     | `bg-red-500` and friends                                                 |
| `raw-px`               | Pixels on font-size, padding, margin, gap, or border-radius              |
| `arbitrary-px`         | `min-h-[56px]` and friends                                               |
| `bare-z-index`         | `z-index: 50`, `z-40`, `z-[100]`                                         |
| `missing-scrollbar`    | A scrolling container with no `.custom-scrollbar`                        |
| `unexported-component` | A component missing from the barrel                                      |
| `stale-a11y-ignore`    | Svelte 4 hyphenated `svelte-ignore` names                                |

Then check the things a script cannot:

- Did you import components, or write markup? Zero imports from
  `../components` in a new view is a red flag.
- Does it look right in **both** light and dark? Toggle and look.
- **Desaturate the screenshot. Can you still read every state?** Colour is never
  the only channel.
- **Is there exactly one lit thing?** Squint at it. If two elements compete for
  the eye, one of them is wrong.
- **Does anything cast a sideways shadow?** There is one light, and it is above.
- Does every interactive element have hover, and does Tab show a focus ring?
- Does every action show its key?
- Is there an empty state, a loading state, and an error state?
- Would this look at home next to the rest of the app, or does it look like a
  different program?
