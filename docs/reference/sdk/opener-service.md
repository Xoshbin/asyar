### `OpenerService` — Open URLs and URI Schemes

**Runs in:** both worker and view.

**Permission required:** `shell:open-url`.

`OpenerService` allows extensions to open URLs and URI schemes in the user's default browser or registered OS handler (e.g. `https://`, `mailto:`, `slack:`, `steam:`, custom deep links).

```typescript
export interface IOpenerService {
  /**
   * Opens the given URL using the system default handler or declared permission scheme.
   *
   * @param url The URL string to open.
   */
  openUrl(url: string): Promise<void>;
}
```

#### Minimal usage

```typescript
import type { IOpenerService } from 'asyar-sdk/contracts';

const opener = context.getService<IOpenerService>('opener');

// Open a web link in the default browser
await opener.openUrl('https://example.com');

// Open a custom protocol scheme (if declared or allowed)
await opener.openUrl('steam://run/3932890');
```

#### Permissions & Security Model

Opening URLs is gated under the `shell:open-url` permission in the extension's `manifest.json`.

Standard web protocols (`http://`, `https://`, `mailto:`) are allowed by default when `shell:open-url` is granted. Additional custom schemes can be scoped via `permissionArgs["shell:open-url"]`.

```json
{
  "permissions": ["shell:open-url"]
}
```
