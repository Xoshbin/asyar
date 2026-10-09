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

## 4. Action Shortcuts Are Declarations (Single Dispatcher)

- An action's `shortcut` both shows the hint and binds the key. It is dispatched by exactly one owner, `services/action/actionShortcutDispatcher.ts`, wired into `lib/keyboard/launcherKeyboard.ts`. **Never** add a `keydown` listener in a feature for a chord that is, or should be, an action; declare `shortcut` on the action instead.
- Use the canonical format `Mod[+Alt][+Shift]+Key` (`lib/keyboard/actionShortcut.ts`). `Mod` is ⌘ on macOS and Ctrl elsewhere. Glyphs (`⌘N`), `Super`, `Ctrl` and plain keys throw at registration for built-ins; a Tier 2 extension's action keeps loading with the bad shortcut dropped and a warning logged.
- Plain keys (Enter, arrows, Space) are not bindable; they stay with list navigation. Destructive actions never get a shortcut. Reserved chords (`Mod+K`, `Mod+,`, `Mod+P`, `Mod+Q`, `Mod+A/C/V/X/Z/Y`) cannot be bound.
- Guard: `built-in-features/shortcutDeclarations.guard.test.ts` fails on a non-canonical shortcut, a collision, or a duplicated hand-written handler.
