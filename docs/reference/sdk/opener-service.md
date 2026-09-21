### `OpenerService` — Open URLs, Paths, and File Manager Items

**Runs in:** both worker and view.

**Permissions required:**

- `shell:open-url` for `openUrl`
- `shell:open-path` for `openPath`
- `fs:read` for `reveal`

`OpenerService` allows extensions to open URLs, external application deep links, local files and directories, and reveal items inside the operating system's file manager (Finder on macOS, File Explorer on Windows, Nautilus/Dolphin on Linux).

```typescript
export interface OpenPathOptions {
  /** Optional application name or bundle to open the path with (e.g. 'Zed', 'Visual Studio Code', 'Ghostty'). */
  with?: string;
}

export interface IOpenerService {
  /**
   * Opens the given URL using the system default handler or declared permission scheme.
   *
   * @param url The URL string to open.
   */
  openUrl(url: string): Promise<void>;

  /**
   * Opens a local file or directory path using the system's default handler or a specified application.
   *
   * @param path The absolute or tilde-prefixed path to open.
   * @param options Options specifying the target application name/bundle.
   */
  openPath(path: string, options?: OpenPathOptions): Promise<void>;

  /**
   * Reveals the file or directory in the system's default file manager.
   *
   * @param path The absolute or tilde-prefixed path to reveal.
   */
  reveal(path: string): Promise<void>;
}
```

#### Minimal usage

```typescript
import type { IOpenerService } from 'asyar-sdk/contracts';

const opener = context.getService<IOpenerService>('opener');

// 1. Open a web link in default browser (requires shell:open-url)
await opener.openUrl('https://example.com');

// 2. Open a custom protocol scheme
await opener.openUrl('slack://channel?id=C12345');

// 3. Open a local file or directory with default app (requires shell:open-path)
await opener.openPath('~/Projects/my-app');

// 4. Open a local file or directory with a specific editor or tool
await opener.openPath('~/Projects/my-app', { with: 'Zed' });

// 5. Reveal a file in Finder / Explorer (requires fs:read)
await opener.reveal('~/Downloads/report.pdf');
```

#### Permissions & Security Model

Declare only the capabilities your extension requires in `manifest.json`:

```json
{
  "permissions": ["shell:open-url", "shell:open-path", "fs:read"]
}
```

- `shell:open-url`: Allows launching browser URLs and deep links. Standard web schemes (`http://`, `https://`, `mailto:`) are supported by default. Additional custom schemes can be scoped via `permissionArgs["shell:open-url"]`.
- `shell:open-path`: Allows launching local filesystem paths using OS default handlers or specified app targets (`with`).
- `fs:read`: Required by `reveal(path)` to verify path existence and reveal it safely in the system file manager without granting arbitrary process execution.
