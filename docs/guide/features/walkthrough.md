# Walkthrough

> Short interactive tasks that turn Asyar's features into daily habits, ticked off automatically as you actually use them.

## What it does

The **Walkthrough** is Asyar's built-in interactive guide to help you master the launcher. Rather than reading long manuals or ticking off static checkboxes, the Walkthrough watches your real activity and marks tasks complete the moment you actually perform the action in your daily workflow.

If you have already been using a feature for weeks, those tasks are already marked complete when you open the list — it only ever shows you the capabilities you haven't discovered yet.

Both core Asyar features and third-party extensions contribute tasks to the Walkthrough.

## How to use it

1. Open Asyar with your global hotkey.
2. Type `walkthrough` (or `tour`, `tips`, or `learn`) and press `Enter`.
3. The Walkthrough view opens, displaying tasks categorized into what you have achieved and what is left to explore.
4. Use `↑` / `↓` to navigate between tasks. The right-hand detail pane explains the feature, why it is useful, and how to try it.
5. As soon as you perform an action (for example, applying a window layout, copying multiple items in Clipboard History, or creating your first snippet), the task automatically updates with a completed checkmark.

## Example tasks

The Walkthrough guides you through high-leverage workflows such as:

- **Launch your first app or search** — Start using Asyar as your primary application launcher.
- **Arrange windows without touching the mouse** — Snap windows to halves, thirds, or fourths using keyboard commands.
- **Multi-select paste** — Hold `⌘` or `Ctrl` to select and paste multiple items simultaneously from Clipboard History.
- **Create an inline calculation or conversion** — Convert currencies or compute expressions right in the search bar.
- **Ask AI inline** — Press `Tab` in the search bar to stream responses from local or cloud AI models.
- **Assign a custom alias or global hotkey** — Give frequent commands dedicated shortcuts.

## Extension contributions

Third-party extensions can contribute their own walkthrough tasks in their `manifest.json` under the `walkthrough` array.

Tasks require no custom code — the launcher tracks completion automatically based on target launches or interactions. See [The Manifest Reference — Walkthrough Tasks](../../reference/manifest.md#walkthrough--teaching-your-features) for development instructions.

## Tips

- **No manual check-off**: You don't need to manually click "Done" or worry about tracking progress. Asyar's background event watcher detects the real action.
- **Safe exploration**: Selecting a task shows the exact command trigger and shortcuts needed so you can try it right away.
- **Revisiting completed tasks**: You can view all completed tasks at any time to refresh your memory on shortcuts and features you previously mastered.

## Related

- [The Basics](../the-basics.md)
- [Getting Started](../getting-started.md)
- [Keyboard Shortcuts](../keyboard-shortcuts.md)
- [Manifest Reference](../../reference/manifest.md)
