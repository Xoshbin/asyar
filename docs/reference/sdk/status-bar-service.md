### 8.6 `StatusBarService` — Independent tray icons

**Runs in:** both worker and view. Tray icons that should stay current
when the launcher is closed must be registered and updated from the
worker.

**Permission required:** None.

Every top-level `IStatusBarItem` an extension registers becomes its own
independent menu-bar tray icon. Asyar's own tray icon stays separate.

See **[status-bar.md](./status-bar.md)** for the full interface, rules,
platform matrix, and migration notes from the pre-Beta shared-tray model.
