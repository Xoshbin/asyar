# Technology Stack & Framework Rules

## 1. Svelte 5 (Always Use Runes)

- **Mandatory Svelte 5 Runes**:
  - Reactive state: `let count = $state(0)`
  - Derived state: `let doubled = $derived(count * 2)`
  - Component props: `let { name, onChange } = $props()` and `let { value = $bindable() } = $props()`
  - Side effects: `$effect(() => { ... })`
- **Forbidden Svelte 4 Syntax**:
  - Never use `export let prop` (use `$props()`).
  - Never use `$:` reactive declarations (use `$derived()` or `$effect()`).
  - Never declare unreactive state variables expecting reactivity without `$state()`.

## 2. Tauri 2 APIs

- Use modern Tauri 2 modular packages (e.g. `@tauri-apps/api/core`, `@tauri-apps/api/event`, `@tauri-apps/plugin-shell`, etc.).
- Never use deprecated Tauri 1 APIs or `@tauri-apps/api/tauri` imports.

## 3. Launcher Hints (One Look)

- A **hint** is an offer to the user, not a result (for example "Search only in Coffee"). Every hint in the launcher list uses the single shared look: a row with `variant: HINT_VARIANT` and `icon: HINT_ICON`, both from `services/search/hintLook.ts`.
- The look lives only in `components/list/LauncherListRow.svelte`. Never restyle a hint per feature, never copy the `.hint-row` / `.hint-chip` CSS, and never give a hint its own icon or colour. `components/list/hintLookGuard.test.ts` enforces the first rule.
- A hint is never `type: 'command'` (command rows hide the launcher or clear the query after they run). Place it beside the group it relates to, and show it only when it changes what the user can do next.
- Full spec: `.agents/skills/design-language/SKILL.md` ("Hints") and `docs/reference/design-system/design-language.md` §6.5.

## 4. Built-in Feature & Extension Icon Squircles

- **Flat Solid Backgrounds**: Use bold, flat solid colors with a 2px specular rim. Never use multi-stop gradients with dark/muddy bottom falloffs or milky radial top-sheens.
- **~19% Optical Margin Sweet-Spot**: Sized to ~62%–65% glyph coverage (`~276px` in a `448px` squircle), avoiding cramped edges and tiny floating glyphs.
- **Single-Container Principle**: Never place a rounded box/keycap inside the squircle; the primary glyph sits directly on the tile.
- **Micro-Scale Contrast**: Foreground elements on white sheets must use dark slate tones (`#0F172A`, `#1E293B`, `#334155`), never pale pastels.
- **Headless Browser Rasterization**: Always rasterize `icon.png` using a headless browser (e.g. Chrome/Blink) because macOS `sips` silently drops `<filter>`, `<feDropShadow>`, and glow effects.
- Full spec: `.agents/skills/design-language/SKILL.md` § "Built-in Feature & Extension Icon Standards".
