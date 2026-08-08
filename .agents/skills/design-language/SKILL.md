---
name: design-language
description: Use when building, modifying, or fixing any frontend UI in the Asyar launcher — new components, new views, layout changes, styling decisions, new built-in features, visual bug fixes, and anything in settings or onboarding. Answers "what do I use here?" for fonts, colour, typography, spacing, components, and layout.
---

# Asyar Design Language

This file answers one question: **given what you are building, what do you use?**

Every table below is a lookup. Find your row, use what it says. If your case
is not in a table, the answer is at the bottom of this file under
[When nothing fits](#when-nothing-fits) — it is never "invent something".

**`pnpm check:design` enforces the mechanical half of this document and runs in
CI.** If it passes, you have not broken the system; it does not mean your UI is
good. The judgement calls are the tables.

---

## The 30-second version

| You need                      | You use                                                                    |
| ----------------------------- | -------------------------------------------------------------------------- |
| Any UI element                | A component from `src/components/index.ts` — read the barrel first         |
| Any colour                    | A `var(--…)` token. Never a hex, `rgb()`, `white`, or a Tailwind colour    |
| Any text size or weight       | A `.text-*` class, or `var(--font-size-*)`                                 |
| Any padding/margin/gap        | `var(--space-*)`                                                           |
| Any corner                    | `var(--radius-*)`                                                          |
| Any stacking                  | `var(--z-*)`                                                               |
| A scrolling container         | Add `.custom-scrollbar`                                                    |
| Something that does not exist | Build a reusable component in `src/components/`, export it from the barrel |

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
- On macOS, `--font-ui` resolves to the system face (San Francisco) instead of
  Satoshi. That is deliberate — do not "fix" it.
- Reach for mono when characters need to line up or be read individually. A
  duration, a count, or a version number in prose stays in `--font-ui`; the
  same value in a table column goes mono with `font-variant-numeric:
tabular-nums`.

---

## 2. Colour — which colour, where

### Surfaces, from back to front

| Token              | Use for                                                      |
| ------------------ | ------------------------------------------------------------ |
| `--bg-primary`     | The window background. You rarely set this yourself          |
| `--bg-secondary`   | Cards, sidebars, panels — anything sitting on the window     |
| `--bg-tertiary`    | Inputs, wells, and subtle insets inside a card               |
| `--bg-hover`       | Hover on any interactive row, button, or tile                |
| `--bg-selected`    | The selected row in a list, the active item                  |
| `--bg-popup`       | Opaque popups and menus                                      |
| `--surface-canvas` | Only where external HTML assumes a white page (URL previews) |

Never set an opaque background on the root container — platform overrides
(macOS transparency, Windows Acrylic, opaque Linux) handle that automatically.

### Text

| Token              | Use for                                                       |
| ------------------ | ------------------------------------------------------------- |
| `--text-primary`   | Headings, labels, the content the user came for               |
| `--text-secondary` | Subtitles, metadata, supporting detail                        |
| `--text-tertiary`  | Placeholders, hints, disabled text, timestamps                |
| `--text-on-accent` | **Text or icons on any filled saturated surface** — see below |

`--text-on-accent` is the answer whenever the background is
`--accent-primary`, `--accent-success/-warning/-danger`, or a per-extension
chip colour. It is white, and it is a token so you never type `#fff` again.

### Semantic state

| Token              | Means                                    |
| ------------------ | ---------------------------------------- |
| `--accent-primary` | Primary action, focus, selection, links  |
| `--accent-success` | Succeeded, healthy, connected            |
| `--accent-warning` | Needs attention, degraded, in progress   |
| `--accent-danger`  | Destructive action, error, failed        |
| `--asyar-brand`    | Asyar's own identity (teal). Not a state |

For a **tinted background** in a state colour, mix it rather than inventing a
second token — this is the house formula:

```css
background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
color: var(--accent-danger);
```

### Lines and separators

| Token            | Use for                                       |
| ---------------- | --------------------------------------------- |
| `--border-color` | The border of an interactive element          |
| `--separator`    | List dividers, section rules, subtle outlines |
| `--divider-soft` | The faintest hairline (split-view handle)     |

### Code colour

Only for rendered code and structured data. The Prism markdown theme and
`JsonTree` both read from these, so a snippet looks the same everywhere.

`--syntax-comment` · `--syntax-keyword` · `--syntax-string` · `--syntax-number` · `--syntax-function`

### Everything else

`--scrim` / `--scrim-opaque` for modal backdrops · `--control-knob` for the
Toggle knob · `--shadow-color` inside shadows only.

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
text.** 600 (`font-semibold`) is for headings only. Never `font-bold` in body
text — the classes above already carry the right weight, which is the main
reason to use them.

---

## 4. Spacing, corners, elevation, motion

**Spacing** — `var(--space-N)`, from `--space-0-5` (2px) to `--space-11`
(48px). Whole steps first. The half-steps (`0-5`, `1-5`, `2-5`, `5-5`, `7-5`)
exist for the cases where a whole step visibly breaks alignment against a
neighbour; reach for one only then. `--space-2-5` is 11px — its name is
historically misordered, so read the value before using it.

**Radius** — `--radius-xs` (4) · `sm` (6) · `md` (8) · `lg` (10) · `xl` (12) ·
`popup` (20) · `full`. Small controls take `sm`, cards take `md`, modals take
`xl`, floating launcher surfaces take `popup`.

**Shadow** — `--shadow-xs` … `--shadow-xl` for lift, `--shadow-popup` for
menus, `--shadow-launcher-popup` for the launcher's floating surfaces,
`--shadow-focus` for focus rings.

**Motion** — `--transition-fast` (100ms) for colour changes,
`--transition-normal` (150ms) for most state changes, `--transition-smooth`
(200ms) and `--transition-slow` (300ms) for movement and reveals. Wrap any
looping or large animation in `@media (prefers-reduced-motion: reduce)`.

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

## 5. Components — which component, where

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

## 6. Layout

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

### The three surfaces

The tokens and components are identical across all three. What differs is
density and how much chrome is acceptable.

| Surface        | Density                                                    | Notes                                                                                               |
| -------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Launcher**   | Tightest. `--space-2`/`--space-3` inside rows              | Keyboard-first: every action needs a key path and a `KeyboardHint`. Chrome stays invisible          |
| **Settings**   | Roomier. `--space-5`/`--space-6` between rows and sections | Always `SettingsSection` → `SettingsRow`. Mouse and keyboard are equal citizens                     |
| **Onboarding** | Roomiest. `--space-7`+ between blocks                      | One idea per stage. `OnboardingStage` owns the frame; a step supplies content, never its own layout |

---

## 7. Interaction and accessibility

Every interactive element covers every state:

| State            | Pattern                                                |
| ---------------- | ------------------------------------------------------ |
| Hover            | `background: var(--bg-hover)`                          |
| Active / pressed | `.pressable`, or `background: var(--bg-selected)`      |
| Keyboard focus   | Nothing — the global `*:focus-visible` ring handles it |
| Disabled         | `opacity: 0.5; cursor: not-allowed`                    |
| Selected in list | `background: var(--bg-selected)` + a left accent bar   |

Transition state changes with `var(--transition-normal)`.

**Focus is already solved globally.** `*:focus-visible` applies
`var(--shadow-focus)` app-wide. Two things break it, both worth knowing:

1. A more specific rule that also sets `box-shadow` (e.g. `.item.active`)
   silently wins. If your component sets `box-shadow` in any state, restate
   the ring in a `:focus-visible` rule **after** it.
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

## 8. Third-party extensions (Tier 2, iframe sandbox)

Extensions run in two sandboxed iframes — a hidden worker and an on-demand
view. Design rules apply to the **view**.

- Every CSS token above is injected automatically, along with the real Satoshi
  and JetBrains Mono files. `var(--bg-primary)`, `var(--font-ui)` etc. just
  work. **The same "never hardcode a colour" rule applies.**
- Icons come from the `<asyar-icon>` web component: call `registerIconElement()`
  once in the view entry, then `<asyar-icon name="calculator" size="20">`.
  Icons inherit `currentColor`.
- There is **no bare `asyar-sdk` entry point** — import from `asyar-sdk/view`,
  `asyar-sdk/worker`, or `asyar-sdk/contracts`. The icon helpers are
  DOM-dependent and ship on `/view` only.
- For IDE autocomplete outside the running app, import `asyar-sdk/tokens.css`.

---

## 9. When nothing fits

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
   it a light and dark value if it is not constant. Then use it.

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

## 10. Before you call it done

Run `pnpm check:design`. It fails on:

| Rule                   | What it catches                                                     |
| ---------------------- | ------------------------------------------------------------------- |
| `undefined-token`      | `var(--x)` where `--x` is defined nowhere — the declaration is dead |
| `token-fallback`       | `var(--x, something)`                                               |
| `hardcoded-color`      | A hex, `rgb()`, `white` or `black` in a colour property             |
| `tailwind-palette`     | `bg-red-500` and friends                                            |
| `raw-px`               | Pixels on font-size, padding, margin, gap, or border-radius         |
| `arbitrary-px`         | `min-h-[56px]` and friends                                          |
| `bare-z-index`         | `z-index: 50`, `z-40`, `z-[100]`                                    |
| `missing-scrollbar`    | A scrolling container with no `.custom-scrollbar`                   |
| `unexported-component` | A component missing from the barrel                                 |
| `stale-a11y-ignore`    | Svelte 4 hyphenated `svelte-ignore` names                           |

Then check the things a script cannot:

- Did you import components, or write markup? Zero imports from
  `../components` in a new view is a red flag.
- Does it look right in **both** light and dark? Toggle and look.
- Does every interactive element have hover, and does Tab show a focus ring?
- Is there an empty state, a loading state, and an error state?
- Would this look at home next to the rest of the app, or does it look like a
  different program?
