### 8.16 `OAuthService` — OAuth 2.0 PKCE flow for third-party providers

**Permission required:** `oauth:use`.

Lets extensions authorize users with any OAuth 2.0 provider (GitHub, Notion, Google, Slack, Jira, …) using a PKCE flow. The extension never handles client secrets or raw tokens — Asyar manages PKCE generation, code exchange, token encryption, and persistent storage entirely in Rust. Extensions call `authorize()`, receive a token, and use it; the rest is handled by the host.

```typescript
interface OAuthConfig {
  /** Stable identifier for this provider, used as the storage key. E.g. `"github"`. */
  providerId: string;
  /** OAuth 2.0 client ID registered with the provider. */
  clientId: string;
  /** The provider's authorization endpoint URL. */
  authorizationUrl: string;
  /** The provider's token exchange endpoint URL. */
  tokenUrl: string;
  /** Requested OAuth scopes. */
  scopes: string[];
}

interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  /** Unix timestamp (seconds). `undefined` means the token has no expiry. */
  expiresAt?: number;
}

interface OAuthError {
  code: 'access_denied' | 'exchange_failed' | 'timeout' | string;
  message: string;
}

interface IOAuthService {
  /**
   * Authorize with a third-party provider via PKCE.
   *
   * Returns a cached valid token immediately if one exists — no browser popup.
   * Otherwise opens the system browser, waits for the callback, and resolves
   * with the token once the user authorizes.
   */
  authorize(config: OAuthConfig): Promise<OAuthToken>;

  /**
   * Remove the stored token for the given provider.
   * The next call to `authorize()` will start a fresh browser flow.
   */
  revokeToken(providerId: string): Promise<void>;
}
```

**Minimal usage:**

```typescript
import type { IOAuthService } from 'asyar-sdk';

const oauth = context.getService<IOAuthService>('oauth');

const token = await oauth.authorize({
  providerId: 'github',
  clientId: 'YOUR_GITHUB_CLIENT_ID',
  authorizationUrl: 'https://github.com/login/oauth/authorize',
  tokenUrl: 'https://github.com/login/oauth/access_token',
  scopes: ['repo', 'read:user'],
});

// token.accessToken is ready to use in API calls
const response = await network.fetch('https://api.github.com/user', {
  headers: { Authorization: `Bearer ${token.accessToken}` },
});
```

**Typical "connect and use" pattern:**

```typescript
import type { IOAuthService, INetworkService, IFeedbackService } from 'asyar-sdk';

const oauth    = context.getService<IOAuthService>('oauth');
const network  = context.getService<INetworkService>('network');
const feedback = context.getService<IFeedbackService>('feedback');

async function fetchGitHubUser() {
  let token: OAuthToken;

  try {
    token = await oauth.authorize({
      providerId: 'github',
      clientId: 'YOUR_CLIENT_ID',
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['read:user'],
    });
  } catch (err: any) {
    // err.message contains the OAuthError code + description
    await feedback.showToast({ title: 'Authorization failed', style: 'failure' });
    return;
  }

  const res = await network.fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  const user = JSON.parse(res.body);
  await feedback.showHUD(`Signed in as @${user.login}`);
}

async function disconnect() {
  await oauth.revokeToken('github');
  await feedback.showHUD('Disconnected from GitHub');
}
```

#### How it works under the hood

`OAuthService.authorize()` uses a **deferred-result pattern** — the IPC response and the final token arrive on two separate channels:

```
Extension iframe                        Host (SvelteKit + Rust)
──────────────────────────────────────────────────────────────────────────
1. SDK generates flowId
2. window.addEventListener('message', …)   ← registered BEFORE invoke
3. broker.invoke('asyar:service:OAuthService:authorize',
     { providerId, clientId, authorizationUrl, tokenUrl, scopes, flowId })
                                           ────────────────────────────►
                                           4. IpcRouter: permission check (oauth:use)
                                           5. ExtensionOAuthService.authorize()
                                              └─ cache hit? return OAuthToken directly
                                                 → invoke() resolves with token ✓
                                              └─ no cache:
                                                 Rust: generate PKCE pair
                                                 Rust: generate opaque state
                                                 Rust: build_auth_url(...)
                                                 Store PendingOAuthFlow in memory
                                                 openUrl(authUrl) → system browser opens
                                                 return { pending: true }
                                           ◄────────────────────────────
6. invoke() resolves { pending: true }
   SDK keeps window listener active…

   [User authorizes in browser]
   Provider → asyar://oauth/callback?code=X&state=Y
                                           Tauri deep-link → 'asyar:deep-link' event
                                           _handleCallback():
                                             Rust: POST tokenUrl
                                                   { code, code_verifier, client_id, … }
                                             Parse token response
                                             AES-256-GCM encrypt tokens
                                             Store in SQLite oauth_tokens table
                                           ◄────────────────────────────
{ type: 'asyar:oauth:result', flowId, token }   (postMessage push)

7. window listener fires, flowId matches
8. authorize() Promise resolves with OAuthToken ✓
```

The `providerId` is used as a **namespaced storage key** — tokens for `"github"` belonging to extension `"com.acme.myapp"` are stored separately from tokens for `"github"` belonging to any other extension. Extensions can never access each other's tokens.

#### Token caching and expiry

On every `authorize()` call, the host checks for a stored, unexpired token first. If one exists and is not within 60 seconds of expiry, it is returned immediately in the IPC response — no browser popup, no network request. This check happens in Rust: `oauth_get_stored_token` returns `None` for expired tokens, so extensions always receive either a usable token or go through the browser flow.

There is currently no automatic refresh of expired tokens. When a token expires, the next `authorize()` call starts a fresh browser flow.

#### Error handling

Errors from `authorize()` reject the returned Promise with a structured message:

| Scenario | What happens | Rejection message |
|---|---|---|
| User clicks "Deny" in browser | Provider redirects with `?error=access_denied` | `"OAuth error [access_denied]: …"` |
| Token exchange HTTP failure | Provider returns non-2xx on the token endpoint | `"OAuth error [exchange_failed]: Token exchange failed (403): …"` |
| `broker.invoke()` itself fails (e.g. missing `oauth:use` permission) | IPC layer rejects before host is reached | `"Permission denied: oauth:use"` |

`revokeToken()` resolves normally even if no token was stored — it is idempotent.

#### Security model

- **PKCE (RFC 7636)** — the `code_verifier` is generated in Rust, never transmitted to the extension, and never stored after the exchange completes. The `code_challenge` (SHA-256 base64url) is sent to the provider; the verifier is only used once during exchange.
- **State parameter** — a cryptographically random 128-bit value generated per flow. The deep-link callback verifier matches the stored state before proceeding, preventing CSRF.
- **Token encryption** — `access_token` and `refresh_token` are AES-256-GCM encrypted in Rust before being written to SQLite, using a machine-local key derived from the app data directory. The plaintext tokens are never written to disk.
- **Extension isolation** — tokens are keyed by `(extensionId, providerId)`. Extensions cannot read tokens that belong to other extensions, even for the same provider.
- **Uninstall cleanup** — when an extension is uninstalled, all its `oauth_tokens` rows are deleted automatically.

#### Privacy & security note for reviewers

`oauth:use` grants an extension the ability to open a browser window and handle an OAuth callback on the user's behalf. Reviewers will check that:

- The `clientId` is hardcoded by the extension developer (not user-supplied).
- `authorize()` is called on an explicit user action (e.g. "Connect to GitHub" button), not silently on load.
- The token is used only for the stated purpose declared in the extension description.

---
