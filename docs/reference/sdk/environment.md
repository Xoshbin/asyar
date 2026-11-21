# environment

The `environment` export provides synchronous metadata and asynchronous getters for the host runtime, platform, theme, and locale.

---

## Direct Import

`environment` is exported directly from `asyar-sdk/view`, `asyar-sdk/worker`, and `asyar-sdk/contracts`:

```typescript
import { environment } from 'asyar-sdk/view'; // or 'asyar-sdk/worker'

// Synchronous properties (with smart runtime fallbacks)
console.log(environment.locale); // "de-DE", "en-US", "zh-Hans-CN"
console.log(environment.language); // "de", "en", "zh"
console.log(environment.region); // "DE", "US", "CN"
console.log(environment.script); // "Hans", "Latn", or null
console.log(environment.numberFormat); // "comma" | "point"
console.log(environment.platform); // "macos" | "windows" | "linux"
console.log(environment.theme); // "dark" | "light"
console.log(environment.isDevelopment); // boolean
console.log(environment.extensionId); // "org.asyar.sample"
```

---

## Asynchronous Query

To fetch a fresh, live snapshot from the Rust host:

```typescript
import { environment } from 'asyar-sdk/view'; // or 'asyar-sdk/worker'

const snapshot = await environment.getEnvironment();
console.log(snapshot);
```

### Snapshot Interface

```typescript
export interface EnvironmentSnapshot {
  readonly locale: string;
  readonly language: string;
  readonly region: string | null;
  readonly script: string | null;
  readonly numberFormat: 'point' | 'comma';
  readonly platform: 'macos' | 'windows' | 'linux';
  readonly theme: 'dark' | 'light';
  readonly isDevelopment: boolean;
  readonly extensionId: string;
  readonly commandId?: string;
}
```

---

## Service Proxy

`EnvironmentServiceProxy` is also available via `ExtensionContext` in both `asyar-sdk/worker` and `asyar-sdk/view`:

```typescript
import { ExtensionContext } from 'asyar-sdk/view'; // or 'asyar-sdk/worker'
import type { IEnvironmentService } from 'asyar-sdk/contracts';

const context = new ExtensionContext();
const envService = context.getService<IEnvironmentService>('environment');
const env = await envService.getEnvironment();
```

---

## Permissions

- **`environment.getEnvironment()` / `environment.getLocale()` / synchronous properties:** **None.** Host environment and locale metadata are public and permission-free.
- **`environment.getPaths()`:** Requires **`files:read`** in `manifest.json` (with `permissionArgs["files:read"]`). OS user directory paths are gated so unprivileged extensions cannot fingerprint the user's OS username or filesystem layout.

---

## OS User Directory Paths (`getPaths`)

Extensions with `files:read` can resolve cross-platform OS user directories without spawning shell scripts or reading environment variables:

```typescript
import { environment } from 'asyar-sdk/view'; // or 'asyar-sdk/worker'

const paths = await environment.getPaths();
console.log(paths.home);
console.log(paths.appData);
console.log(paths.localAppData);
console.log(paths.config);
```

### `EnvironmentPaths` Interface

```typescript
export interface EnvironmentPaths {
  readonly home: string;
  readonly appData: string;
  readonly localAppData: string;
  readonly config: string;
}
```

### Platform Mapping

These are the OS user directories (not Asyar's own internal app data directory):

| Field          | macOS                           | Windows                  | Linux                                |
| -------------- | ------------------------------- | ------------------------ | ------------------------------------ |
| `home`         | `/Users/<user>`                 | `C:\Users\<user>`        | `/home/<user>`                       |
| `appData`      | `~/Library/Application Support` | `%APPDATA%` (Roaming)    | `$XDG_DATA_HOME` or `~/.local/share` |
| `localAppData` | `~/Library/Application Support` | `%LOCALAPPDATA%` (Local) | `$XDG_DATA_HOME` or `~/.local/share` |
| `config`       | `~/Library/Application Support` | `%APPDATA%` (Roaming)    | `$XDG_CONFIG_HOME` or `~/.config`    |
