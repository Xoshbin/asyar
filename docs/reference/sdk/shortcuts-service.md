### 8.43 `ShortcutsService` — List and run Apple Shortcuts

**Runs in:** both worker and view.

**Permissions required:** two granular permissions, declare only what you use.

| Permission       | Methods  |
| ---------------- | -------- |
| `shortcuts:read` | `list()` |
| `shortcuts:run`  | `run()`  |

List the user's Apple Shortcuts and run them. Available on **macOS** only; on other platforms every call rejects with `Unsupported platform operation`.

The host runs the system `shortcuts` tool itself, so an extension needs neither `shell:spawn` nor a per-binary shell consent prompt, and no entry is added to Runs and no notification is shown.

- `list()` returns each shortcut's stable UUID and current name. The UUID survives renames, so persist it rather than the name.
- `run(idOrName, input?)` runs a shortcut by UUID or name and waits for it to finish. A non-empty `input` is passed as the shortcut's Shortcut Input. It resolves with the shortcut's text output (an empty string when there is none) and rejects if the shortcut exits with an error. Names that start with `-` are rejected, and `input` is limited to 1 MiB. A shortcut that outputs more than 8 MiB is stopped and the call rejects.
- `run()` has a 300 second IPC timeout because a shortcut can take a long time; the shortcut keeps running if the call times out.

```typescript
interface ShortcutInfo {
  id: string; // stable UUID
  name: string;
}

interface IShortcutsService {
  list(): Promise<ShortcutInfo[]>;
  run(idOrName: string, input?: string): Promise<string>;
}
```

```typescript
const shortcuts = context.getService<IShortcutsService>('shortcuts');
const all = await shortcuts.list();
const output = await shortcuts.run(all[0].id, 'some text');
```
