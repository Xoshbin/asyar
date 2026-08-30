# Privacy-First & Local-First Outbound Data Egress Policy

Asyar is a local-first platform built on the guarantee that user data stays private and on-device by default.

## 1. The Core Egress Invariant

**NO USER DATA EVER LEAVES THE DEVICE THROUGH ASYAR UNLESS EXPLICITLY PERMITTED BY AUTHENTICATION, ENTITLEMENT, AND USER CONSENT.**

All outbound network requests must be gated against an explicit policy before any socket is opened or HTTP payload constructed.

## 2. Policy Matrix by Egress Channel

| Channel / Category                                                                                                              | Endpoints                                       | Required Gates                                                                                                                                                                                      | Default                         | Fail-Closed Policy                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Private User Data** (Settings, Snippets, Notes, Shortcuts, Portals, Clipboard, AI history, Extensions, Extension preferences) | `POST /api/sync/items`<br>`GET /api/sync/items` | 1. Authenticated session (`auth_state.token` is valid)<br>2. Active subscription (`sync:settings` / `sync:ai-conversations` entitlement)<br>3. Explicit user consent (`user.syncEnabled !== false`) | **Locked** (Signed-out = inert) | **Strictly blocked**: No network requests, no sync timer ticks, no provider subscriptions, no serialization. |
| **Crash Reports**                                                                                                               | `POST /api/feedback`                            | `privacy.crashReportMode !== 'off'`                                                                                                                                                                 | **Off**                         | **Dropped locally**: Never sent without consent.                                                             |
| **Anonymous Usage Metrics**                                                                                                     | `POST /api/usage`                               | `privacy.usageShareMode !== 'off'`                                                                                                                                                                  | **Off**                         | **Dropped locally**: Never sent without consent.                                                             |

## 3. Defense-in-Depth Requirements

1. **Rust-Level Enforcement**: Never rely solely on frontend guards. The Rust backend command handlers (`sync_run`, `ApiClient`) must independently enforce token presence, entitlement validity, and policy rules before initiating network calls.
2. **Session Expiration Auto-Purge**: If the server returns `401 Unauthorized` or token revocation, the local auth session (`auth_state` and disk `auth.dat`) must be purged immediately, terminating background sync loops.
3. **Cross-Window Consistency**: Any auth state transition (login, logout, token expiration) must be broadcast across all webview windows (`asyar:auth-changed`) to guarantee immediate sync teardown or initialization.
4. **User-Accessible Controls**: Users must always have the ability in Settings to inspect and toggle data-sharing / sync features on or off, even when signed out.
