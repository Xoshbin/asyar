# File Search

> Find any file on your machine by name, instantly, with a rich preview.

## What it does

File Search indexes your home folder in the background and lets you find any file by name — instantly, no matter how large your home folder is. It excludes caches, dependency folders (`node_modules`, `.git`, build output, …), and system/VM directories by default, so results are files you actually care about.

The detail pane on the right shows a real preview: images render as thumbnails, text and code files show their content, and (on macOS) other file types — PDFs, videos, archives — get a Quick Look-style preview too. The list itself shows small thumbnails for images so you can spot the file you want without opening the preview.

Everywhere else in the app, typing a search that doesn't match many apps or commands shows a "Search files for…" row — press `Enter` on it to jump straight into File Search with your query already filled in.

## How to use it

1. Open Asyar and type `files` — or select **Search Files** from search results.
2. Start typing a filename. Results narrow as you type; the more specific your query, the faster it narrows.
3. Use `↑` / `↓` to move through results. The preview pane on the right updates as you move.
4. To narrow by file type, click the dropdown in the search bar (or press `⌘P`) and choose Documents, Images, Code, Audio & Video, Archives, or Folders.
5. Press `Enter` to open the selected file with its default app.
6. Double-click a row to open it directly.

## Shortcuts & actions

| Action                          | How                     |
| ------------------------------- | ----------------------- |
| Open file                       | `Enter` or double-click |
| Quick Look preview              | `Space`                 |
| Reveal in Finder                | `⌘R`                    |
| Copy Path                       | `⌘⇧C`                   |
| Copy Name                       | `⌘⌥C`                   |
| Open in Terminal                | `⌘T`                    |
| Toggle Pin                      | `⌘P`                    |
| Send to Asyar AI                | `Tab` or `⌘I`           |
| Search Everywhere (Deep Search) | `⌘⇧F`                   |
| Open action panel               | `⌘K`                    |

**Action panel (⌘K) entries while the list is open:**

- **Reveal in Finder** — shows the file in your system file manager.
- **Copy Path / Copy Name** — copies the absolute path or just the filename to your clipboard.
- **Open in Terminal** — opens the file's containing folder in your default terminal app.
- **Toggle Pin** — pins the file so it shows up first when you open File Search with no query yet, or unpins it.
- **Move to Trash** — moves the file to the system trash. This is destructive — Asyar asks for confirmation.
- **Quick Look** — a full preview without opening the file.
- **Send to Asyar AI** — opens AI Chat with the file's path (and, for text/code files under the size cap, its contents) pre-filled so you can ask a question about it.
- **Search Everywhere** — escalates your current query to your OS's native search (Spotlight on macOS, Everything on Windows if installed, `plocate` on Linux if installed). Useful for finding something outside your indexed folders, or by content rather than name. This runs once, on demand — never automatically as you type.
- **Clear Search History** — forgets which files you've selected before (used to rank frequently-opened files higher). Also available from the root search bar without opening the view.

## Tips

- **Pin your most-used files.** With no search query typed, the list shows your pinned files instead of being empty — a quick way to jump to a handful of files you open constantly.
- **The fallback row saves a step.** If you're already typing in the main search bar and it's not matching many apps or commands, look for "Search files for…" and press `Enter` instead of retyping into File Search.
- **Search Everywhere is a deliberate extra step**, not something that runs on every keystroke — it shells out to a real OS search tool, which is slower than Asyar's own index but reaches files outside your indexed roots.
- **Large files are never fully loaded just to preview them.** Text previews are capped, and images/other previews are generated as small cached thumbnails — so even a huge video file or a multi-gigabyte archive previews quickly instead of stalling the app.
- **Configure what gets indexed** in **Settings → File Search** — narrow to specific folders, add exclude patterns, or turn indexing off entirely. See [Settings](../settings.md#file-search).
- **Indexing your whole home folder uses more resources than the rest of Asyar.** Keeping a live, searchable index of a large home folder means some ongoing background CPU/memory use beyond Asyar's usual light footprint — normally brief scans plus small background updates as files change. If you'd rather keep Asyar as lean as possible and don't need file search, turn it off (or narrow **Search Roots** to just the folders you actually search) in **Settings → File Search**.

## Related

- [The Basics](../the-basics.md)
- [Settings](../settings.md)
- [Clipboard History](./clipboard-history.md)
