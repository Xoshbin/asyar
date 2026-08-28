# Keyboard Shortcuts & Input Safety

## 1. Preserve Native Text Editing Shortcuts

- In any view with an active search bar or editable text field, **never hijack standard OS text editing shortcuts**:
  - `⌘ + Backspace` / `⌘ + Delete`: Deletes line of text to start. **NEVER bind to delete/trash item**.
  - `⌥ + Backspace` / `⌥ + Delete`: Deletes previous word.
  - `⌘ + A`, `⌘ + C`, `⌘ + V`, `⌘ + X`, `⌘ + Z`: Standard clipboard and undo operations.
- The search bar is the primary interaction point; user expectations for text editing take precedence over list-level actions.

## 2. Destructive Actions & Item Deletion

- **Action Panel First**: Destructive item operations (Delete, Move to Trash, Uninstall, Clear) belong in the **`⌘K` Action Panel** with proper `destructive: true` styling and confirmations where applicable.
- **No `⌘⌫` for Item Deletion**: Do not assign `Super+Backspace` or `⌘⌫` as a shortcut for deleting list items, history entries, snippets, or files.
- If a direct shortcut is ever required for list item deletion, use non-conflicting chords (e.g. `⌃X` / `Control+X` or `⌘⌥⌫`) that do not interfere with typing in the search input.

## 3. Empty-Input Guarding for Navigation

- Shortcuts that repurpose keys like `Backspace`, `Delete`, or `Escape` for navigation (such as going back or dismissing context mode):
  - Must verify that the search query is strictly empty (`query === ''` or `input.value === ''`).
  - Must defer to any focused `<input>`, `<textarea>`, or `contenteditable` elements.
