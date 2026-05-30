# Using Asyar

Asyar is a keyboard-first launcher: press your global hotkey, start typing, and
act — without touching the mouse. This guide walks you through everything Asyar
can do.

## Start here

1. **[Getting Started](./getting-started.md)** — Install Asyar, finish the first-run setup, and run your first search.
2. **[The Basics](./the-basics.md)** — How search, results, navigation, and the action panel work. The mental model behind everything else.

## Features

See **[Features](./features/)** for a guide to each built-in: Calculator,
Clipboard History, Snippets, Window Management, Aliases & Shortcuts, Portals,
Scripts, AI & Agents, MCP, Browser Integration, and the Extension Store.

## Reference & help

- **[Keyboard Shortcuts](./keyboard-shortcuts.md)** — Every shortcut in one place.
- **[Settings](./settings.md)** — A tour of every settings tab.
- **[Sync & Backup](./sync-and-backup.md)** — Your account, cloud sync, encryption, and backups.
- **[Troubleshooting](./troubleshooting.md)** — Fixes for the most common problems.
- **[FAQ](./faq.md)** — Quick answers.

---

## Page template (for contributors writing this guide)

Every **feature** page follows the same shape so the manual reads consistently:

    # <Feature / Topic>

    > One-sentence summary of what this does for the user.

    ![<hero alt text>](../../images/<name>.png)
    *Figure: <what the hero shot shows>.*
    <!-- image-todo: <name>.png — <what to capture> -->

    ## What it does
    ## How to use it      (numbered, keyboard-first steps; add inline image slots where a step is easier shown than told)
    ## Shortcuts & actions (the action-panel actions and any key hints)
    ## Tips
    ## Related            (links to other guide pages)

Images live in `docs/images/` (a single folder at the docs root — the site serves
them from there). Use `../images/...` from top-level guide pages and `../../images/...`
from pages inside `features/`. Until a PNG is added, the slot renders as a broken-image
icon by design — run `grep -rn "image-todo" docs/guide` to list every slot still to fill.
