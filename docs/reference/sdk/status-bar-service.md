### 8.6 `StatusBarService` — Independent tray icons

**Runs in:** both worker and view. Tray icons that should stay current
when the launcher is closed must be registered and updated from the
worker.

**Permission required:** None.

Every top-level `IStatusBarItem` an extension registers becomes its own
independent menu-bar tray icon. Asyar's own tray icon stays separate.

Optional `title` displays up to 32 Unicode characters next to a top-level icon
(no control characters or newlines; submenu children cannot have titles).

| Platform | Title presentation                                                                     |
| -------- | -------------------------------------------------------------------------------------- |
| macOS    | Full text to the right of the icon; emoji-only icons prefix the title.                 |
| Linux    | AppIndicator label, which the desktop environment may hide (GNOME needs an extension). |
| Windows  | Tooltip fallback: `title — text`.                                                      |

`updateItem(id, updates)` shallow-merges updates into the registered item,
preserving omitted fields and callbacks. A supplied `submenu` replaces the
old tree wholesale. `title: ''` or `title: undefined` clears the title; an
unknown or unregistered id throws. Caller identity is supplied by the host,
not by the item or IPC payload.

See **[status-bar.md](./status-bar.md)** for the full interface, rules,
platform matrix, and migration notes from the pre-Beta shared-tray model.
