---
name: design-language
description: Use when building, modifying, or fixing any frontend UI in the Asyar launcher. Triggers on new components, new views, layout changes, styling decisions, new built-in extensions, and visual bug fixes. Ensures visual consistency across the entire app.
---

# Asyar Design Language

**All UI work MUST use the existing design system. No exceptions. No "fix it later." No "just for the demo."**

## The Iron Rule

**Use existing components. Use CSS variables. Use design tokens. If a component you need doesn't exist, create a new reusable component in `src/components/` — never inline custom one-off styling.**

Violating the letter of this rule IS violating the spirit. "I used CSS variables but wrote my own button" is still a violation.

---

## Component-First Development

Before writing ANY UI code, check `src/components/index.ts` for existing components. Import from the barrel file:

```svelte
import {(Button, Input, EmptyState, ListItem, SplitView)} from '../../components';
```

### Available Components

`src/components/index.ts` is the source of truth — it is grouped by category
and currently exports ~74 components. The table below is the subset you will
reach for most often; **read the barrel before concluding something doesn't
exist.**

**Base** — `Button`, `IconButton`, `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`, `Badge`, `Icon`, `IconBox`, `ExtensionAvatar`, `StatusDot`, `MeterBar`, `StatTile`, `KeyboardHint`, `ShortcutRecorder`, `TabGroup`, `SegmentedControl`, `Modal`

**Feedback** — `EmptyState`, `ErrorState`, `InlineError`, `LoadingState`, `WarningBanner`, `FeedbackMessage`, `DialogHost`, `EntitlementGate`

**Layout** — `AppBar`, `Card`, `ActionFooter`, `ActionListPopup`, `BottomActionBar`, `BottomBarButton`, `InformationPanel`, `PrimaryActionDisplay`, `SearchHeader`, `SearchResultsArea`, `SplitListDetail`, `ShortcutCaptureOverlay`

**List** — `ListItem`, `ListItemActions`, `ResultsList`, `SplitView`, `LauncherListRow`, `RankedStatRow`, `CalcResultCard`

**Settings** — `SettingsRow`, `SettingsSection`, `SettingsTopBar`, `SettingsForm`, `SettingsFormRow`, `SettingsRadioGroup`, `SettingsRangeSlider`, plus `AppearanceThemeSelector`, `WindowModeSelector`, `ExtensionDetailPanel`, `ExtensionPreferencesForm`

**Form** — `FormField`, `PlaceholderPicker`

**Onboarding** — `OnboardingStage`, `GuidanceStep`, `StepProgress`, `LauncherHint`, `TestBox`, `ExpansionDemo`

**Search** — `ArgumentChipRow`, `CommandArgInput`, `ArgumentDropdownChip`, `SearchBarAccessoryDropdown`

The ones with non-obvious contracts:

| Need                 | Component         | Notes                                                                                                                                                                                       |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any dialog / modal   | `Modal`           | Native `<dialog>`. Props: `isOpen` (bindable), `title`, `subtitle`, `width`, `dismissible`, `onEscape`, `onEnter`; `children` + `actions` snippets. **This is the target for all dialogs.** |
| Confirm prompt       | `ConfirmDialog`   | Built on `Modal`, variants default/danger. **Not exported from the barrel** — import `components/base/ConfirmDialog.svelte` directly, or go through `DialogHost`.                           |
| App-wide dialog slot | `DialogHost`      | Renders the queued confirm dialog; prefer this over mounting `ConfirmDialog` yourself                                                                                                       |
| Status badge         | `Badge`           | variants: default, success, warning, danger, info                                                                                                                                           |
| Icon                 | `Icon`            | built-in SVG icons with `name` prop                                                                                                                                                         |
| Icon container       | `IconBox`         | sized container: sm/md/lg/xl                                                                                                                                                                |
| Status indicator     | `StatusDot`       | color: success/warning/danger/info, optional pulse                                                                                                                                          |
| Tab navigation       | `TabGroup`        | variants: pills, sidebar                                                                                                                                                                    |
| List item            | `ListItem`        | leading/title/subtitle/trailing slots                                                                                                                                                       |
| Results list         | `ResultsList`     | virtual scrolling search results                                                                                                                                                            |
| Split two-panel      | `SplitView`       | resizable left/right with drag handle                                                                                                                                                       |
| Master/detail page   | `SplitListDetail` | list + detail pane with the standard empty state                                                                                                                                            |
| Empty state          | `EmptyState`      | icon snippet, message, description, children                                                                                                                                                |
| Loading state        | `LoadingState`    | animated spinner with message                                                                                                                                                               |
| Form field wrapper   | `FormField`       | label, hint, error props                                                                                                                                                                    |
| Settings section     | `SettingsSection` | title, description props                                                                                                                                                                    |
| Settings row         | `SettingsRow`     | label, description, control slot                                                                                                                                                            |

### When a Component Doesn't Exist

If you need a UI element that has no matching component above:

1. **Create a new reusable component** in `src/components/{category}/NewComponent.svelte`
2. **Export it** from `src/components/index.ts`
3. **Use design tokens** (CSS variables, not hardcoded values) in its styling
4. **Follow existing component patterns** — look at similar components for prop conventions
5. **Import and use it** from the barrel file

**Never** create a one-off styled element inline. If it's worth building, it's worth making reusable.

---

## Philosophy

Asyar is a **keyboard-first, native-feeling desktop launcher**. Every design decision should reinforce:

- **Invisible chrome** — the UI gets out of the way; content is king
- **Native feel** — looks and behaves like an OS-native app on macOS, Windows, and Linux
- **Clarity** — every element has a clear purpose; nothing decorative without function
- **Consistency** — same visual weight and interaction pattern everywhere

---

## CSS Variables — Never Hardcode

**Never hardcode colors, radius, spacing, shadows, transitions, or font sizes.** Every value must come from a CSS variable so theming, dark/light mode, and platform overrides work automatically.

### Colors

| Token                   | Use for                                    |
| ----------------------- | ------------------------------------------ |
| `var(--bg-primary)`     | Main window background                     |
| `var(--bg-secondary)`   | Cards, sidebars, secondary surfaces        |
| `var(--bg-tertiary)`    | Inputs, subtle backgrounds                 |
| `var(--bg-hover)`       | Hover states on interactive elements       |
| `var(--bg-selected)`    | Selected/active states in lists            |
| `var(--bg-popup)`       | Opaque popups and modals (no transparency) |
| `var(--text-primary)`   | Headings, labels, important content        |
| `var(--text-secondary)` | Subtitles, metadata, secondary info        |
| `var(--text-tertiary)`  | Placeholders, hints, disabled text         |
| `var(--border-color)`   | Borders on interactive elements            |
| `var(--separator)`      | List dividers, section borders             |
| `var(--accent-primary)` | Primary actions, focus rings               |
| `var(--accent-success)` | Success states                             |
| `var(--accent-warning)` | Warnings                                   |
| `var(--accent-danger)`  | Destructive actions, errors                |
| `var(--shadow-color)`   | Box shadows only                           |
| `var(--asyar-brand)`    | Brand color (#2EC4B6)                      |

**Never add fallback values to CSS variables** (e.g., `var(--bg-primary, #1e1e2e)`). All variables are always defined globally — fallbacks indicate the author didn't check the design system.

### Border Radius

| Token                | Value  | Use for           |
| -------------------- | ------ | ----------------- |
| `var(--radius-xs)`   | 4px    | Small elements    |
| `var(--radius-sm)`   | 6px    | Buttons, inputs   |
| `var(--radius-md)`   | 8px    | Cards, panels     |
| `var(--radius-lg)`   | 10px   | Large containers  |
| `var(--radius-xl)`   | 12px   | Modals            |
| `var(--radius-full)` | 9999px | Circular elements |

### Spacing

Use `var(--space-N)` tokens: `--space-1` (4px) through `--space-11` (48px).

### Transitions

| Token                      | Value              |
| -------------------------- | ------------------ |
| `var(--transition-fast)`   | 100ms ease         |
| `var(--transition-normal)` | 150ms ease         |
| `var(--transition-smooth)` | 200ms cubic-bezier |
| `var(--transition-slow)`   | 300ms cubic-bezier |

### Shadows

Use `var(--shadow-xs)` through `var(--shadow-xl)`, `var(--shadow-popup)`, `var(--shadow-focus)`.

### Font Sizes

Use `var(--font-size-2xs)` through `var(--font-size-display)`. Never write pixel font sizes.

### Fonts

| Token              | Use for                                   |
| ------------------ | ----------------------------------------- |
| `var(--font-ui)`   | All UI text (Satoshi)                     |
| `var(--font-mono)` | Code, monospaced content (JetBrains Mono) |

---

## Typography

| Use case             | Class                                                      |
| -------------------- | ---------------------------------------------------------- |
| Page title           | `.text-page-title`                                         |
| Section header       | `.text-section`                                            |
| Item title           | `.text-title`                                              |
| Body text            | `.text-body`                                               |
| Label                | `.text-label`                                              |
| Caption / hint       | `.text-caption`                                            |
| Subtitle             | `.text-subtitle`                                           |
| Monospace            | `.text-mono`                                               |
| Section group header | `.section-header` (xs, uppercase, tracking-wide, tertiary) |

- Never use `font-bold` in body text — `font-medium` (500) is the heaviest for UI labels
- Use `font-semibold` (600) only for prominent headings

---

## Layout Architecture

Every view inside the launcher fits this fixed shell:

```
┌─────────────────────────────────┐  ← SearchHeader (fixed, 52px, z-50)
│  SearchHeader                   │
├─────────────────────────────────┤
│                                 │
│  Scrollable content area        │  ← height: calc(100vh - 72px)
│  (flex-1, overflow-y-auto)      │    or use SplitView for master/detail
│                                 │
├─────────────────────────────────┤
│  BottomActionBar (fixed, 40px)  │  ← Always present
└─────────────────────────────────┘
```

- **Never** add a second fixed header or footer inside a view
- Content area scrolls; header and footer are always visible
- For master/detail layouts use the `SplitView` **component** — not a custom flex layout

---

## Global CSS Classes

All defined in `src/resources/styles/style.css`. Use these instead of writing custom CSS:

### Buttons

Use the `Button` component. If you must use raw HTML: `.btn`, `.btn-primary`, `.btn-danger`, `.btn-success`, `.btn-secondary`, `.btn-full`.

### Inputs

Use the `Input` component. If you must use raw HTML: `.input` class. For full-width settings inputs: `.field-input`.

### Cards

Use the `Card` component. CSS classes: `.card`, `.card-elevated`.

### Badges

Use the `Badge` component. CSS classes: `.badge`, `.badge-primary`, `.badge-secondary`, `.badge-success`, `.badge-warning`, `.badge-danger`.

### Keyboard Shortcuts

Use the `KeyboardHint` component. CSS class: `.keyboard-shortcut`.

### List Items

Use the `ListItem` component. CSS classes: `.result-item`, `.result-title`, `.result-subtitle`, `.selected-result`.

### Surfaces

`.surface-primary`, `.surface-secondary`, `.surface-popup`.

### Layout

`.view-container`, `.view-header`, `.app-layout`, `.search-header`, `.split-view`, `.split-view-left`, `.split-view-right`.

### Scrollbar

Always add `.custom-scrollbar` to any scrollable container.

### Interactive

`.pressable` — adds `scale(0.97)` on active state.

---

## Interaction States

Every interactive element must cover all states:

| State            | Pattern                                                  |
| ---------------- | -------------------------------------------------------- |
| Default          | Base styles                                              |
| Hover            | `background-color: var(--bg-hover)`                      |
| Active/Pressed   | `background-color: var(--bg-selected)` or `.pressable`   |
| Focus (keyboard) | `box-shadow: var(--shadow-focus)`                        |
| Disabled         | `opacity: 0.5; cursor: not-allowed`                      |
| Selected (list)  | `background-color: var(--bg-selected)` + left accent bar |

Use `transition: var(--transition-normal)` for state changes. Never use `outline: none` without a visible `:focus-visible` alternative.

---

## Icons

- Size: `w-5 h-5` (20px) for list items; `w-4 h-4` (16px) for inline/button icons
- Color: `var(--text-secondary)` for decorative; `var(--accent-primary)` for active
- Always add `shrink-0` in flex layouts
- Use the `Icon` component for built-in icons (Tier 1 only — not available in extension iframes)

---

## Third-Party Extensions (Tier 2 — iframe sandbox)

Third-party extensions run in **two sandboxed iframes per extension**
(worker + view). Design rules apply only to the **view** iframe (the
on-demand UI panel) — the worker iframe is hidden and renders nothing.
Token / font injection covers both, but visible styling lives on the
view side. Imports in the view bundle should come from `asyar-sdk/view`
(see [`asyar-sdk/README.md`](../../../asyar-sdk/README.md) for the
subpath split).

**There is no bare `asyar-sdk` entry point.** The package's `exports` map
declares only `./worker`, `./view`, `./contracts`, and `./tokens.css`.
`import { x } from 'asyar-sdk'` fails to resolve — always use a subpath.

### Design Tokens & Fonts — Automatic

The host injects tokens and fonts into every extension iframe automatically:

- All CSS custom properties (`var(--bg-primary)`, `var(--font-ui)`, etc.) are available with no setup
- Satoshi and JetBrains Mono font files are sent as base64 data URIs so `var(--font-ui)` renders the real typeface, not a system fallback

During development (outside the running app), import the static fallback for IDE autocomplete:

```typescript
import 'asyar-sdk/tokens.css'; // in main.ts
```

Or in plain CSS:

```css
@import 'asyar-sdk/tokens.css';
```

### Icons — `<asyar-icon>` Web Component

Third-party extensions use the `<asyar-icon>` web component from `asyar-sdk/view`. Register it once in the view bundle's entry, then use it anywhere in the extension HTML/template:

```typescript
// main.view.ts
import { registerIconElement } from 'asyar-sdk/view';
registerIconElement(); // idempotent — safe to call multiple times
```

The icon helpers are DOM-dependent, so they ship on the **view** entry only —
they are not available from `asyar-sdk/worker`.

```html
<asyar-icon name="calculator" size="20"></asyar-icon>
<asyar-icon name="clipboard" size="16" stroke-width="1.5"></asyar-icon>
```

- Icons inherit `currentColor` — set `color` on the element or a parent to control icon color
- `size` defaults to `20`; `stroke-width` defaults to `1.5`
- Full icon name list: see `docs/reference/design-system/icons.md`

For programmatic SVG (e.g. canvas, dynamic injection), use `renderIcon()`:

```typescript
import { renderIcon, hasIcon } from 'asyar-sdk/view';

if (hasIcon('calculator')) {
  el.innerHTML = renderIcon('calculator', { size: 20, strokeWidth: 2 });
}
```

### The Same Iron Rules Apply

All CSS variable rules in this skill apply equally to Tier 2 extensions. Never hardcode colors, sizes, radii, or font names. `var(--font-ui)` renders Satoshi; `var(--font-mono)` renders JetBrains Mono. Always use tokens.

---

## Empty & Loading States

Use the `EmptyState` and `LoadingState` components. Never create custom empty/loading UI:

```svelte
<EmptyState message="No notes yet" description="Create a note to get started" />
<LoadingState message="Loading notes..." />
```

---

## Scrollable Areas

Always add `.custom-scrollbar` to any scrollable container:

```svelte
<div class="flex-1 overflow-y-auto custom-scrollbar">...</div>
```

---

## Platform Awareness

The `html` element has a `data-platform` attribute (`"darwin"`, `"win32"`, `"linux"`).

- **macOS**: Full transparency + `backdrop-filter: blur(25px)` via `.macos-panel`
- **Windows**: Native Acrylic; `.macos-panel` has `backdrop-filter: none`
- **Linux**: Fully opaque backgrounds (WebKitGTK limitation)

**Do NOT** set opaque background colors on the root container — platform overrides handle this automatically.

---

## Red Flags — STOP and Fix

- **Imported zero components** from `../../components` → Stop. Check what exists first.
- **Created a custom styled button** instead of using `Button` or `.btn` → Use the component. This includes raw `<button class="btn-primary">` — always use the `Button` component, even inside snippets/slots of other components.
- **Created a custom empty state** div → Use `EmptyState` component.
- **Created a custom list item** layout → Use `ListItem` component.
- **Created a custom split layout** → Use `SplitView` component.
- **Raw `<input>` without `Input` component or `.input` class** → Use the component.
- **Hardcoded hex/rgb color** anywhere → Replace with CSS variable.
- **Used pixel values** for font-size, padding, margin, radius, min/max dimensions, or spacing → Replace with design token (`var(--space-*)`, `var(--font-size-*)`, `var(--radius-*)`).
- **Tailwind arbitrary values with hardcoded pixels** like `max-w-[160px]`, `h-[200px]` → These are still hardcoded values. Use design tokens or Tailwind's built-in scale.
- **Added CSS variable fallbacks** like `var(--bg-primary, #1e1e2e)` → Remove fallback.
- **Wrote a `<style>` block with >20 lines of custom CSS** → You're probably bypassing the design system. Use components and utility classes instead.
- **Used `rounded-*` Tailwind** for border-radius → Use `var(--radius-*)`.
- **Missing `.custom-scrollbar`** on a scrollable container → Add it.
- **Interactive element with no hover/focus state** → Add proper state handling.
- **`outline: none` without `:focus-visible`** → Add focus ring.
- **"Fix styling later" or "polish after"** in comments → No. Design system compliance is not optional polish.

**All of these mean: you are bypassing the design system. Stop, use what exists, fix before moving on.**

---

## Rationalization Table

| Excuse                                                  | Reality                                                                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| "It's faster to write custom CSS"                       | It's faster to import `Button` than to write 15 lines of button CSS. Components exist for this reason.          |
| "This is just for the demo / prototype"                 | Prototypes become production code. Use the design system from the start.                                        |
| "I'll fix the styling later"                            | You won't. "Later" never comes. Do it right now.                                                                |
| "This component is slightly different"                  | Use the existing component with its props. If truly different, create a new reusable component.                 |
| "It's just one small inline style"                      | One becomes ten. Use CSS variables and design tokens.                                                           |
| "I know the hex value"                                  | The design system knows it better. It handles dark mode, light mode, and platform overrides. You don't.         |
| "The existing component doesn't do exactly what I need" | Extend the component or create a new one in `src/components/`. Never inline one-off UI.                         |
| "Custom CSS gives me more control"                      | The design system gives you consistency across the entire app. That matters more than control over one element. |
| "It's inside a slot/snippet so it doesn't count"        | Components must be used everywhere — including inside snippets, children, and slot content of other components. |
| "Tailwind arbitrary values are still utility classes"   | `max-w-[160px]` is a hardcoded pixel value with extra syntax. Use Tailwind's built-in scale or design tokens.   |
