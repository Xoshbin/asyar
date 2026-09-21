# Usage Statistics

> Track your productivity, top commands, launches, and estimated time saved.

## What it does

Asyar keeps a lightweight, private log of command and application launches directly on your machine. The **Usage Stats** view visualizes how much time Asyar is saving you, which commands and applications you use most often, and your launch activity over time.

All metrics are stored locally in your SQLite database and are **never sent over the network or shared with external analytics services**.

## What is displayed

- **Total Launches**: The cumulative number of commands, applications, scripts, and snippets launched through Asyar.
- **Estimated Time Saved**: An estimate based on standard desktop interaction benchmarks (opening apps via finder/dock vs. instant hotkey activation).
- **Most Used Items**: Ranked list of your top applications, extensions, and commands with usage counts and percentage bars (`RankedStatRow`).
- **Recent Activity**: High-level trends showing your launcher engagement over daily and weekly windows.

## How to use it

1. Open Asyar with your global hotkey.
2. Type `usage stats` (or `stats`, `metrics`, or `time saved`) and press `Enter`.
3. The Usage Stats view opens, showing your top-level metric tiles (`StatTile`) and breakdown rows.
4. Use `↑` / `↓` to inspect ranked items.

## Shortcuts & actions

| Action              | How                                                 |
| ------------------- | --------------------------------------------------- |
| Open Usage Stats    | Search `usage stats` and press `Enter`              |
| Clear Usage History | Open `⌘K` in Usage Stats and choose **Clear Stats** |

## Privacy & local storage

- **100% Local**: All launch counters and timestamps are recorded in the local SQLite database (`asyar_data.db`).
- **Zero Telemetry**: Asyar does not phone home with your launch frequencies, command choices, or habit data.
- **Data Reset**: If you ever want a fresh start, use **Clear Stats** from the action panel (`⌘K`).

## Tips

- **Identify shortcut candidates**: Check your top 5 most frequently launched items in Usage Stats. If any of them don't have a dedicated global hotkey or search alias yet, assign one in [Aliases & Shortcuts](./aliases-and-shortcuts.md) to save even more time.
- **Clean tracking**: Testing or development launches can be purged with the clear action without affecting your settings or extensions.

## Related

- [The Basics](../the-basics.md)
- [Aliases & Shortcuts](./aliases-and-shortcuts.md)
- [Walkthrough](./walkthrough.md)
- [Settings](../settings.md)
