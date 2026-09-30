# Notes

> Write, organize, pin, and search Markdown notes without leaving your keyboard.

## What it does

Notes gives you an instant, distraction-free Markdown scratchpad directly inside Asyar. Whether you need to jot down a quick thought, draft meeting notes, pin a checklist to your desktop as a sticky window, or append a line to your daily log, Notes handles it without having to launch a bulky note-taking application.

Every note is stored locally in SQLite on your machine, with full Markdown rendering, code highlighting, title and content search, and pinning.

## How to use it

### Open the Notes editor

1. Open Asyar and type `notes` — or select **Notes** from search results.
2. The notes view opens. The left pane lists your notes (pinned notes first, followed by recent notes).
3. Use `↑` / `↓` to move through your notes, or start typing in the search bar to filter by title or body.
4. Press `⌘N` (or choose **New Note** from `⌘K`) to create a new note.
5. Edit your note in the right pane. Title and content save automatically as you type.

### Quick Note (Instant Capture)

Capture ideas without opening the full editor view:

1. Open Asyar and type `note <your thought here>`.
2. Press `Enter`.
3. The note is created and saved immediately in the background, confirmed with a toast notification.

### Add to Today (Daily Log)

Keep a daily running journal or scratchpad:

1. Open Asyar and type `today <log entry>`.
2. Press `Enter`.
3. Asyar appends your text to today's note (automatically titled with today's date, creating it if it doesn't exist yet).

### Desktop Sticky Notes

Keep important information visible over your workspace:

1. In the Notes view, select any note and press `⌘S` (or choose **Stick to Desktop** from `⌘K`).
2. The note detaches into a lightweight, floating desktop sticky window that stays on top of other applications.
3. Or type `sticky` from the search bar to create a fresh blank sticky note on your desktop.

## Shortcuts & actions

| Action                   | Shortcut           |
| :----------------------- | :----------------- |
| Notes                    | `Enter` on Notes   |
| Create New Note          | `⌘N`               |
| Toggle Pin / Unpin       | `⌘P`               |
| Stick to Desktop (Float) | `⌘S`               |
| Copy as Markdown         | `⌘⇧C`              |
| Duplicate Note           | `⌘D`               |
| Export as Markdown file  | `⌘E`               |
| Delete Note              | `⌘K` → Delete Note |
| Open Action Panel        | `⌘K`               |

**Action panel (⌘K) entries while Notes is open:**

- **New Note** (`⌘N`) — creates a blank note and places the cursor in the editor.
- **Toggle Pin** (`⌘P`) — pins or unpins the selected note. Pinned notes always sort to the top.
- **Stick to Desktop** (`⌘S`) — floats the note as a desktop sticky window.
- **Copy Markdown** (`⌘⇧C`) — copies the note's formatted title and body to your clipboard.
- **Duplicate Note** (`⌘D`) — clones the note into a new copy.
- **Export Markdown** (`⌘E`) — exports the note to a standalone `.md` file on your filesystem.
- **Delete Note** — permanently deletes the note (prompts for confirmation).

## Tips

- **Fast capture with hotkeys** — Assign a global shortcut to **Quick Note** or **Add to Today** in **Settings → Extensions** to capture thoughts in a single keystroke.
- **Markdown formatting** — Notes supports headers (`#`), bold/italic (`**bold**`), lists (`- [ ] task`), code blocks, and blockquotes with live preview.
- **Daily notes keep history organized** — Using `today <text>` groups your sporadic thoughts under a single daily note, keeping your note list tidy.
- **Disabling Notes** — You can turn off the Notes feature in **Settings → Extensions**. When disabled, its commands (`Notes`, `Quick Note`, `New Sticky Note`, `Add to Today`), views, and search entries are hidden. Existing notes stored in SQLite are preserved intact and will reappear upon re-enabling. Authorized Tier 2 extensions with `notes:read` and `notes:write` permissions retain full access to query and create notes via the `INotesService` platform API even while the bundled UI is disabled.

## Related

- [The Basics](../the-basics.md)
- [Snippets](./snippets.md)
- [Clipboard History](./clipboard-history.md)
- [Notes Service API](../../reference/sdk/notes-service.md)
