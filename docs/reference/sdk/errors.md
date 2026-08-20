# Error Handling & Error Classes

`asyar-sdk` provides typed error classes for handling IPC errors, permission issues, and timeouts in extensions.

All custom errors inherit from `AsyarError`, which extends the standard JavaScript `Error`.

---

## Error Class Hierarchy

```
Error
 └── AsyarError
      ├── PermissionDeniedError
      ├── PermissionConsentRequiredError
      └── IpcTimeoutError
```

---

## Error Classes

### `AsyarError`

Base error class for all SDK and host IPC errors.

```typescript
export class AsyarError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>);
}
```

- `code`: Machine-readable error code (e.g. `'PERMISSION_DENIED'`, `'IPC_TIMEOUT'`, `'UNKNOWN_ERROR'`).
- `details`: Optional structured metadata accompanying the error.
- `message`: Human-readable error message.

---

### `PermissionDeniedError`

Thrown when an IPC call is blocked because the required permission is not declared in `manifest.json`.

```typescript
export class PermissionDeniedError extends AsyarError {
  public readonly permission?: string;

  constructor(message: string, permission?: string);
}
```

- `code`: `'PERMISSION_DENIED'`
- `permission`: The name of the missing permission (e.g. `'clipboard:read'`, `'network'`).
- `details`: `{ permission?: string }`

---

### `PermissionConsentRequiredError`

Thrown when an extension declared a permission in `manifest.json`, but the user has not yet consented to or approved the permission set (or consent was withheld pending review in Settings).

```typescript
export class PermissionConsentRequiredError extends AsyarError {
  public readonly permission?: string;

  constructor(message: string, permission?: string);
}
```

- `code`: `'PERMISSION_CONSENT_REQUIRED'`
- `permission`: The permission requiring user consent.
- `details`: `{ permission?: string }`

---

### `IpcTimeoutError`

Thrown when an IPC call between an extension and the host times out before receiving a response envelope.

```typescript
export class IpcTimeoutError extends AsyarError {
  public readonly command?: string;
  public readonly timeoutMs?: number;

  constructor(message: string, command?: string, timeoutMs?: number);
}
```

- `code`: `'IPC_TIMEOUT'`
- `command`: The wire command that timed out (e.g. `'storage:get'`).
- `timeoutMs`: The timeout duration in milliseconds.
- `details`: `{ command?: string, timeoutMs?: number }`

---

## Usage & Catching Errors

Instead of matching brittle error message strings, use standard `instanceof` checks:

```typescript
import {
  PermissionDeniedError,
  PermissionConsentRequiredError,
  IpcTimeoutError,
  AsyarError,
} from 'asyar-sdk/contracts'; // or from 'asyar-sdk/worker' / 'asyar-sdk/view'

try {
  await clipboard.readCurrentText();
} catch (err) {
  if (err instanceof PermissionConsentRequiredError) {
    // Permission is in manifest.json, but user needs to grant consent in Settings
    console.warn(`Please grant consent for ${err.permission} in Settings > Extensions.`);
  } else if (err instanceof PermissionDeniedError) {
    // Permission was not declared in manifest.json
    console.error(`Permission ${err.permission} is missing from manifest.json.`);
  } else if (err instanceof IpcTimeoutError) {
    // IPC call timed out
    console.error(`Command ${err.command} timed out after ${err.timeoutMs}ms.`);
  } else if (err instanceof AsyarError) {
    // Other structured SDK error
    console.error(`Asyar error [${err.code}]:`, err.message, err.details);
  } else {
    // Non-Asyar generic error
    console.error('Unexpected error:', err);
  }
}
```

---

## Wire Protocol (`asyar:response`)

When the host IPC pipeline rejects a request, the `asyar:response` envelope carries structured error information:

```typescript
interface IPCResponse<T = any> {
  type: 'asyar:response';
  messageId: string;
  result?: T;
  error?: string; // Human-readable error message
  errorCode?: string; // Machine-readable enum (e.g. 'PERMISSION_DENIED')
  errorDetails?: Record<string, unknown>; // e.g. { permission: 'clipboard:read' }
}
```
