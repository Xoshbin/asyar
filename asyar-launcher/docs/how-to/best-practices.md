---
order: 4
---
## 15. Best Practices & Performance

### Do

- **Resolve services in `main.ts`, pass as props.** Never call `getService()` inside Svelte components.
- **Create exactly one `ExtensionContext` per iframe.** Creating more than one attaches duplicate event listeners.
- **Always unregister actions in `onDestroy`.** Leftover actions pollute the ⌘K drawer for other views.
- **Set `viewPath` on search results.** The `action` closure is ignored for installed extensions; `viewPath` is what actually controls navigation.
- **Bundle everything.** Svelte's runtime, component libraries, utility packages — all of it must be in `dist/`.
- **Use `logger.debug()` aggressively during development.** Strip or convert to `logger.info()` before publishing.
- **Use `var(--bg-primary)` and friends** for all background and text colors to support light/dark theming.
- **Validate before publishing.** `asyar validate` catches manifest errors before they reach reviewers.

### Don't

- **Don't use `window.fetch()` or `XMLHttpRequest`.** The iframe CSP blocks all external requests. Use `NetworkService`.
- **Don't use `<script src="https://...">` CDN tags.** Blocked by CSP. Bundle all dependencies locally.
- **Don't request permissions you don't use.** Reviewers will reject extensions with unnecessary permissions.
- **Don't create a second `ExtensionContext`.** One per iframe — period.
- **Don't call `getService()` inside reactive blocks or component constructors.** Always resolve in `main.ts`.
- **Don't rely on the `action` function for result navigation** (Tier 2). Use `viewPath` instead.

### Performance tips

**Small bundles:** Avoid heavy dependencies. Prefer lightweight libraries. Use `vite-bundle-visualizer` to inspect what is contributing to bundle size.

**In-view search:** Use `SearchEngine` from the SDK for filtering lists within your view. It handles subsequence matching and typo tolerance out of the box — no need to implement your own fuzzy search or pull in a separate library. It runs synchronously and is fast enough for keystroke-by-keystroke filtering without debounce.

**Background iframes:** Every `searchable: true` extension always has a background iframe running. If your `search()` method does expensive work, cache aggressively and debounce internally.

**Lazy loading views:** For multi-view extensions, `main.ts` is loaded once. Only mount the component for the current `?view=` parameter. Avoid importing all views at the top of `main.ts` if they are large:

```typescript
// main.ts — conditional import for large views
const viewName = new URLSearchParams(window.location.search).get('view');

if (viewName === 'LargeView') {
  const { default: LargeView } = await import('./LargeView.svelte');
  mount(LargeView, { target: document.getElementById('app')!, props: { ... } });
} else {
  const { default: DefaultView } = await import('./DefaultView.svelte');
  mount(DefaultView, { target: document.getElementById('app')!, props: { ... } });
}
```

**StatusBar updates:** The `updateItem()` method is safe to call on every timer tick. Updates are debounced internally.

---
