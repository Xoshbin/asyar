### `FileManagerService` — Reveal files and move to trash

**Permissions required:** `fs:read` (reveal), `fs:write` (trash).

Cross-platform file manager operations. Reveal files in the OS file manager or move them to the OS trash (recoverable).

```typescript
interface IFileManagerService {
  /**
   * Reveals a file or directory in the OS file manager, selecting it.
   * @param path Absolute path to the file or directory.
   */
  showInFileManager(path: string): Promise<void>;

  /**
   * Moves a file or directory to the OS trash / recycle bin.
   * Path must be within the user's home directory tree.
   * @param path Absolute path to the file or directory.
   */
  trash(path: string): Promise<void>;
}
```

**Minimal usage:**

```typescript
import type { IFileManagerService } from 'asyar-sdk';

const fm = context.getService<IFileManagerService>('fs');

// Reveal a file in the OS file manager
await fm.showInFileManager('/Users/me/Documents/report.pdf');

// Move a file to trash (recoverable by the user)
await fm.trash('/Users/me/Downloads/old-file.zip');
```

**Typical pattern — file manager extension with feedback:**

```typescript
import type { IFileManagerService, IFeedbackService } from 'asyar-sdk';

const fm       = context.getService<IFileManagerService>('fs');
const feedback = context.getService<IFeedbackService>('feedback');

async function revealDownload(path: string) {
  try {
    await fm.showInFileManager(path);
  } catch (err) {
    await feedback.showToast({
      title: 'File not found',
      message: String(err),
      style: 'failure',
    });
  }
}

async function cleanupFile(path: string) {
  const confirmed = await feedback.confirmAlert({
    title: 'Move to Trash?',
    message: `This will trash ${path.split('/').pop()}`,
    primaryAction: 'Trash',
  });

  if (confirmed) {
    await fm.trash(path);
    await feedback.showHUD('Moved to Trash');
  }
}
```

#### How it works under the hood

```
Extension iframe                         Host (Svelte + Rust)
─────────────────────────────────────────────────────────────────────────
1. SDK proxy calls:
   broker.invoke('filemanager:showInFileManager',
     { path })
                                          ─────────────────────────────►
                                          2. ExtensionIpcRouter:
                                             serviceMap['filemanager']
                                               → 'FileManagerService'
                                             permission check (fs:read)
                                          3. fileManagerService
                                               .showInFileManager(path)
                                             → invoke('show_in_file_manager')
                                          4. Rust: validate path
                                             → std::process::Command
                                               (platform-specific)
                                             return Ok(())
                                          ◄─────────────────────────────
5. Promise resolves in extension
```

Both operations are synchronous request/response — no streaming, no callbacks, no handles. The Rust command validates the path and delegates to the OS immediately.

#### Cross-platform behavior

| Platform | `showInFileManager` | `trash` |
|---|---|---|
| macOS | `open -R <path>` — opens Finder and selects the item | `trash` crate → `NSFileManager.trashItem` |
| Windows | `explorer /select,<path>` — opens Explorer and selects the item | `trash` crate → Shell API with `FOFX_RECYCLEONDELETE` |
| Linux | `xdg-open <parent_dir>` — opens the parent directory in the default file manager | `trash` crate → freedesktop.org trash spec |

**Linux note:** Most Linux file managers do not support selecting a specific file via CLI. `showInFileManager` opens the containing folder instead of highlighting the file.

#### Path restrictions

- **Both methods:** Path must be absolute and must exist on disk. Relative paths and non-existent paths are rejected.
- **`trash()` only:** Path must be within the user's home directory tree. Paths outside (e.g., `/etc/hosts`, `/usr/bin/python`) are rejected for safety. Path traversal attacks (e.g., `~/../../etc/hosts`) are caught via normalization.

#### Error handling

| Scenario | Behavior |
|---|---|
| Relative path | Promise rejects: `"Path must be absolute: ..."` |
| Path does not exist | Promise rejects: `"Path does not exist: ..."` |
| `trash()` outside home directory | Promise rejects: `"Access denied: path '...' is outside home directory"` |
| `fs:read` / `fs:write` not in manifest | IPC call rejects (permission denied) |
| OS file manager unavailable | Promise rejects with platform-specific spawn error |

#### Security model

- **Path validation in Rust.** All validation happens in the Rust layer — the TS host service is a thin passthrough.
- **Home directory restriction.** `trash()` is restricted to the home directory tree to prevent extensions from trashing system files or other users' data.
- **Traversal prevention.** Paths are normalized (resolving `..` components) before the home directory check, preventing traversal attacks.
- **No per-extension state.** Unlike `ShellService`, `FileManagerService` stores no trust records or per-extension data. Uninstalling an extension requires no cleanup for this service.

#### Privacy & security note for reviewers

`fs:write` grants the ability to move files to the OS trash. Reviewers will verify:

- `trash()` is called only in response to an explicit user action, not silently on load.
- The extension documents which files it may trash and why.
- No extension uses `trash()` to destroy user data maliciously (the OS trash is recoverable, but the action still warrants scrutiny).

---
