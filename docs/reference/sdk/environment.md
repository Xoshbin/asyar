# environment

The `environment` export provides synchronous metadata and asynchronous getters for the host runtime, platform, theme, and locale.

---

## Direct Import

`environment` is exported directly from the SDK (`asyar-sdk/contracts`, `asyar-sdk/view`, `asyar-sdk/worker`, or `@asyar/sdk`):

```typescript
import { environment } from '@asyar/sdk';

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
import { environment } from '@asyar/sdk';

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

`EnvironmentServiceProxy` is also available via `ExtensionContext`:

```typescript
import { ExtensionContext } from 'asyar-sdk/view';
import type { IEnvironmentService } from 'asyar-sdk/contracts';

const context = new ExtensionContext();
const envService = context.getService<IEnvironmentService>('environment');
const env = await envService.getEnvironment();
```

---

## Permissions

**None.** Host environment and locale metadata are public and permission-free.
