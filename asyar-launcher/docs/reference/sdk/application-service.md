### 8.18 `ApplicationService` — Active application metadata

**Permission required:** `application:read`

The `ApplicationService` allows extensions to retrieve metadata about the currently focused (frontmost) application. This is useful for extensions that want to providing context-aware actions or information based on what the user is currently doing.

```typescript
interface IApplicationService {
  /** Retrieves the currently focused application metadata */
  getFrontmostApplication(): Promise<FrontmostApplication>;
}

interface FrontmostApplication {
  /** The window title (requires Accessibility permissions on macOS) */
  title: string;
  /** The localized name of the application (e.g. "Google Chrome") */
  name: string;
  /** The platform-specific identifier (Bundle ID on macOS, process name on Windows) */
  bundleId: string;
  /** The absolute path to the application executable or bundle */
  path: string;
}
```

**Usage:**

```typescript
const appService = context.getService<IApplicationService>('ApplicationService');

// Get the focused app
const app = await appService.getFrontmostApplication();

console.log(`User is currently in: ${app.name}`);
console.log(`Window title: ${app.title}`);
console.log(`App identifier: ${app.bundleId}`);
console.log(`App path: ${app.path}`);
```

### Platform Notes

#### macOS Accessibility Permissions
Retrieving the **window title** on macOS requires **Accessibility Permissions**. 

If Asyar lacks these permissions, the `title` field will be returned as an empty string. On the first call to this service, Asyar will check if permissions are granted. if they are missing, it will automatically open the **System Settings > Privacy & Security > Accessibility** panel to guide the user.

#### Windows
On Windows, `bundleId` returns the executable name (e.g. `chrome.exe`). The `name` field returns the localized description from the file version info if available, otherwise it falls back to the file name.

---
