## 12. Authentication & Subscription System

Asyar uses a **feature-entitlement model** to gate premium capabilities. Plans are collections of entitlement strings; the desktop app caches and checks these strings at runtime. No tier names are hardcoded — adding a new subscription tier or moving a feature between tiers requires only an admin panel change, not a code deploy.

### Entitlement Strings

```
sync:settings           — Cloud settings sync
sync:ai-conversations   — Sync AI chat history to cloud
ai:chat                 — Use AI chat features
ai:advanced-models      — Access premium AI models
extensions:premium      — Install premium extensions
```

### Auth Flow (Deep Link)

1. Desktop calls `POST /api/desktop/auth/initiate?provider=github` → receives `{ sessionCode, authUrl }`.
2. `authUrl` is opened in the system browser via `@tauri-apps/plugin-opener`.
3. User completes OAuth on `asyar.org`. The backend generates a Sanctum token with `['desktop', 'sync']` scopes (90-day expiry) and redirects the browser to `asyar://auth/callback?session_code=X`.
4. `tauri-plugin-deep-link` intercepts the `asyar://` URL and emits an `asyar:deep-link` Tauri event.
5. The frontend's `authService` receives the event and calls `auth_poll` (Rust command) which fetches the token + user + entitlements from the backend's session cache.
6. The full auth payload is encrypted (AES-256-GCM, key derived from app data path via Argon2id) and persisted to `auth.dat` via Tauri Store plugin. In-memory `AuthState` is populated.

### Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| **Laravel backend** | OAuth flow, token issuance, entitlement resolution (`plan_entitlements` + `entitlement_overrides`), Sanctum token lifecycle |
| **Rust (`src-tauri/src/auth/`)** | Token persistence (encrypted `auth.dat`), in-memory `AuthState`, HTTP API client (`reqwest`), Tauri command wrappers |
| **TS (`authService.svelte.ts`)** | Reactive auth state (`$state`), login/logout flows, background entitlement refresh, offline grace-period logic |
| **TS (`entitlementService.svelte.ts`)** | Synchronous `check(entitlement)` — free tier always allowed, premium gated when logged in |
| **Svelte (`EntitlementGate.svelte`)** | Declarative feature gating — shows upsell overlay when entitlement is missing |
| **Extension SDK** | `EntitlementServiceProxy` exposes `check()` and `getAll()` to Tier 2 extensions via standard IPC (requires `entitlements:read` manifest permission) |

### Offline Behavior

| Scenario | Behavior |
|----------|----------|
| Cached entitlements < 7 days old, network down | Use cached entitlements, log warning |
| Cached entitlements > 7 days old, network down | Clear entitlements, show non-blocking notification |
| Never logged in | All features work (free tier = no restrictions) |

### Token Security

- Token encrypted with AES-256-GCM before writing to `auth.dat`.
- Key derived from the app data directory path using Argon2id — machine-specific, not a secret, but prevents casual file reading.
- On any 401 from the backend, `AuthState` is cleared and the user is prompted to re-authenticate.
- Future: migrate to OS keychain once `tauri-plugin-keychain` stabilizes.

### Backend Tables

| Table | Purpose |
|-------|---------|
| `plans` | Subscription tiers with pricing metadata |
| `plan_entitlements` | Many-to-many: plan → entitlement strings |
| `subscriptions` | User's active subscription, status, payment provider |
| `entitlement_overrides` | Admin-granted per-user entitlements (beta testers, lifetime deals) |

---
