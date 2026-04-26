# Extension Types

Asyar has two top-level extension types. The legacy `"view"` / `"result"` /
`"logic"` distinction is gone — those have been collapsed into a single
unified type whose commands choose `mode: "view"` or `mode: "background"`
independently.

## Pages in this section

- **[Extension](./extension.md)** — `type: "extension"` (default). The
  unified type for everything that surfaces commands, panels, search
  results, schedules, tray icons, or background work. One worker iframe
  plus on-demand view iframes per extension.
- **[Theme](./theme.md)** — `type: "theme"`. A pure declarative restyle of
  the launcher with no JavaScript and no iframes — just `theme.json`.
- **[In-view search](./in-view-search.md)** — Handling the global search bar
  while a `mode: "view"` panel is open.
