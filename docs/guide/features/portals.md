# Portals

> Save URLs as named launchers you can find by name.

![A portal result in search](../images/feature-portals-hero.png)
*Figure: a portal result appearing in search.*
<!-- image-todo: feature-portals-hero.png — a portal result in search -->

## What it does

Portals are named URL shortcuts you can find and open from the Asyar search bar just by typing their name. Think of them as bookmarks that live inside the launcher.

A portal is made of three things: a **name** (what you search for), a **URL** (where it goes), and an **icon** (an emoji shown in the result list). The URL can be static (`https://github.com`) or dynamic — you can embed placeholders like `{query}` so that typing after the portal name fills in a search query before opening the page.

Portals appear as regular search results the moment you type their name, so finding them is as fast as finding any other command.

## How to use it

**To create a portal:**

1. Open Asyar and search for **New Portal**, or type `portals` and press `Enter` to open the Portals view, then press `⌘N`.
2. Fill in the **Name** — this is what you will search for later.
3. Enter the **URL**. To make it dynamic, include `{query}` in the URL (for example `https://google.com/search?q={query}`). Type `{` to open the placeholder picker, or click the `{ }` button.
4. Optionally change the **Icon** emoji.
5. Press **Save** (`⌘S`) or click the Save button.

**To open a portal:**

1. Open Asyar and start typing the portal's name.
2. The portal appears in the search results. Press `Enter` to open it in your default browser.
3. If the URL has a `{query}` placeholder, press `Tab` when you see the portal chip — then type your search query and press `Enter`.

**To manage portals:**

Type `portals` and press `Enter` to open the Portals view. Use `↑` / `↓` to select portals, and use `⌘K` to edit, duplicate, or delete the selected portal.

## Shortcuts & actions

| Action | How |
|--------|-----|
| New portal (in view) | `⌘N` |
| Save form | `⌘S` |
| Cancel form | `Esc` |
| Open action panel | `⌘K` |

**Action panel (⌘K) entries inside the Portals view:**

- **New Portal** — open the new-portal form.
- **Edit** — edit the selected portal's name, URL, or icon.
- **Duplicate** — create a copy of the selected portal.
- **Delete** — permanently remove the selected portal (with confirmation).

## Available placeholders

When building a dynamic portal URL, press `{` or click the `{ }` button to insert any of these:

| Placeholder | What it inserts |
|-------------|----------------|
| `{query}` | The text you type after pressing `Tab` on the portal chip |
| `{Selected Text}` | Text currently selected in the frontmost app |
| `{Clipboard Text}` | Current text content of the clipboard |
| `{UUID}` | A randomly generated UUID v4 |
| `{Date}` | Today's date |
| `{Time}` | Current time |
| `{Date & Time}` | Today's date and current time |
| `{Weekday}` | Current day name (e.g. Tuesday) |

## Tips

- **Quick search portals** — set up portals for search engines you use often. For example, a GitHub issues portal with URL `https://github.com/search?q={query}&type=issues` means you can search GitHub Issues directly from Asyar.
- **Static portals** — a URL without any placeholder opens immediately on `Enter`, no Tab step needed. Great for dashboards or frequently visited pages.
- **Tab to activate** — for portals with `{query}`, the launcher shows a chip. Press `Tab` to set the chip, type your query, then `Enter` to open.
- **Icons are emoji** — use any emoji as the icon. It shows up in search results to help you spot the portal at a glance.

## Related

- [The Basics](../the-basics.md)
- [Aliases & Shortcuts](./aliases-and-shortcuts.md)
- [Browser Integration](./browser-integration.md)
