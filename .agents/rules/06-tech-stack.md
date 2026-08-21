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
