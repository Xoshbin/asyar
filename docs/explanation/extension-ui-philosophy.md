---
order: 3
---

# Extension UI Philosophy — Why Asyar Uses Open Webviews

If you have built extensions for Raycast before, one of the first things you will notice in Asyar is that `asyar-sdk` does **not** ship a `<List>`, `<Detail>`, or `<Form>` component kit. Instead, when an extension opens a `mode: "view"` panel, it renders inside a real HTML/CSS/JS webview — closer to **VS Code's Webview model** than Raycast's declarative component tree.

This page explains **why** Asyar is designed this way, what trade-offs it avoids, and how Asyar keeps simple list extensions fast to build without locking down richer UIs.

---

## The Hybrid Split: Host-Rendered Core + Open Webviews

Asyar divides extension UI into two deliberate layers:

1. **Host-rendered declarative surfaces** — where consistency across every extension matters most, the launcher itself draws the UI from plain JSON:
   - **Root search results** (`ExtensionResult` returned by `search()` commands)
   - **Extension & command preferences** ([`preferences`](../reference/sdk/preferences.md) in `manifest.json`, rendered automatically in Settings)
   - **Command arguments** ([`arguments`](../reference/command-arguments.md) in `manifest.json`, rendered as inline chips in the search bar)
   - **Searchbar accessory dropdowns** ([`searchBarAccessory`](../reference/searchbar-accessory.md) in `asyar-sdk/view`)
   - **Bottom Action Bar & `⌘K` Action Panel** ([`context.registerAction(...)`](../reference/actions.md))

2. **Open Webviews (`mode: "view"`)** — when a command opens its own panel, it runs in a sandboxed `<iframe>` (`asyar-extension://<id>/view.html`). You own 100% of the DOM and can use Svelte, React, Vue, or plain TypeScript/HTML, styled with [`asyar-sdk/tokens.css`](../reference/design-system/tokens.md) and [`<asyar-icon>`](../reference/design-system/icons.md).

---

## Why Not Ship a UI Widget Kit in `asyar-sdk`?

It is tempting to export pre-built components like `<asyar-list>` or `<asyar-button>` from `asyar-sdk`. Asyar explicitly forbids this (the **zero-widget-kit rule**), because of the exact trap VS Code ran into with [`@vscode/webview-ui-toolkit`](https://github.com/microsoft/vscode-webview-ui-toolkit) — which Microsoft eventually **deprecated and archived**:

1. **Bundled widgets freeze inside published extensions.**
   Tier 2 extensions bundle `asyar-sdk` into their own `dist/` output at build time. Any UI component exported from `asyar-sdk` becomes frozen inside every already-published Store extension. Whenever the launcher updates its design language, spacing, or accessibility behavior, old extensions stay stuck with drifting, outdated widgets.
2. **Double the UI maintenance surface.**
   Maintaining a separate Web Component library in `asyar-sdk` alongside the launcher's own Svelte 5 UI creates constant maintenance drag and visual skew between built-in features and installed extensions.

For that reason, `asyar-sdk` ships **only**:

- Typed service proxies (`files`, `clipboard`, `selection`, `actions`, `environment`, etc.)
- Host-pushed CSS design tokens (`asyar-sdk/tokens.css`, theme variables, and fonts)
- `<asyar-icon>` (the sole custom element — a stateless SVG icon registry wrapper, not an interactive layout/form widget)
- Typed view event helpers (`onSearch`, `onKey`)

---

## Why Not a Declarative JSON UI Engine (Raycast's Model)?

The other alternative is having the launcher draw _every_ view from declarative JSON over IPC (like Raycast's `<List>`, `<Detail>`, `<Detail.Metadata>`, and `<Form>`).

Beyond the cost of building and maintaining a second UI reconciler over IPC, a locked-down component set puts a hard ceiling on what extensions can ever look like or do:

- **Real-world example — Speedtest:**
  In a declarative-only model without native gauge or chart primitives, an extension like [Raycast's Speedtest](https://github.com/raycast/extensions/tree/main/extensions/speedtest) cannot render real animated gauges or trend charts. To work around `<Detail>` + `<Detail.Metadata>` (see [`dashboard.tsx`](https://github.com/raycast/extensions/blob/main/extensions/speedtest/src/components/dashboard.tsx) and [`svg.ts`](https://github.com/raycast/extensions/blob/main/extensions/speedtest/src/lib/svg.ts)), it has to:
  1. Render the entire dashboard as a raw SVG string, base64-encode it, and embed it inside a Markdown `<img>`.
  2. Mutate the image `alt` text on every sample to bypass image caching and fake animation.
  3. Hardcode Light/Dark colors in JavaScript because CSS `prefers-color-scheme` and host theme variables cannot reach inside a base64 Markdown `<img>`.

- **In Asyar:**
  An extension view is a real browser document. In Asyar's own `asyar-speedtest-extension`, `SpeedGauge.svelte` and `TrendChart.svelte` are normal Svelte components using native `<svg>`, CSS transitions, and `tokens.css` variables. Light mode, Dark mode, and custom user themes apply automatically with zero hacks.

---

## Making Simple Lists Fast: Typed Helpers + Copy-Owned Templates

Choosing open webviews does **not** mean every developer should have to reinvent search filtering, arrow-key navigation, and `Enter` / `⌘K` wiring from scratch just to display a list of items.

Instead of hiding list UI behind an opaque SDK widget kit, Asyar takes the **shadcn/ui approach**:

1. **Typed view helpers in `asyar-sdk/view`:**
   [`onSearch(cb)` and `onKey(cb)`](../reference/extension-types/in-view-search.md) wrap the launcher's `asyar:view:search` and `asyar:view:keydown` `postMessage` events with TypeScript types and automatic cleanup — while leaving raw `window.addEventListener('message', ...)` available if you ever want it.
2. **Copy-owned List View starter template:**
   `create-extension` generates a clean, searchable list view directly into your extension's own [`src/DefaultView.svelte`](../../asyar-launcher/src/built-in-features/create-extension/template/src/DefaultView.svelte.tmpl) (complete with `onSearch` filtering, `ArrowUp`/`ArrowDown` selection, `scrollIntoView`, and `context.registerAction({ primary: true, shortcut: 'Enter' })`).
3. **Full ownership:**
   Because that code lives in your extension's repository rather than inside a frozen SDK bundle, you get a working list out of the box **and** complete freedom to customize, restyle, or replace any part of it.

---

See also: [Two-tier model](./two-tier-model.md) · [Extension runtime](./extension-runtime.md) · [Actions & Primary Actions](../reference/actions.md)
