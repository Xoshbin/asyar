### 8.11 `EntitlementService` — Subscription feature gating

**Permission required:** `entitlements:read`

Lets your extension check whether the current user holds a specific subscription entitlement. Useful for conditionally showing premium UI or disabling calls to paid backend services.

**Free-tier rule:** If the user is not signed in, `check()` returns `true` for every entitlement string. Gate logic only activates for signed-in users who lack the entitlement.

```typescript
interface IEntitlementService {
  /** Returns true if the user has the entitlement, OR if the user is not logged in. */
  check(entitlement: string): Promise<boolean>;

  /** Returns all entitlement strings currently active for this user. */
  getAll(): Promise<string[]>;
}
```

**Known entitlement strings:**

| String | Feature |
|--------|---------|
| `sync:settings` | Cloud settings sync |
| `sync:ai-conversations` | AI conversation history sync |
| `ai:chat` | AI chat access |
| `ai:advanced-models` | Premium AI models |
| `extensions:premium` | Install premium extensions |

**Usage:**

```typescript
// manifest.json
{
  "permissions": ["entitlements:read"]
}

// main.ts
const entitlements = context.getService<IEntitlementService>('EntitlementService');

// Check before calling a paid API
if (await entitlements.check('ai:chat')) {
  // proceed with AI call
} else {
  await notifications.notify({
    title: 'Upgrade required',
    body: 'AI chat requires an active subscription.'
  });
}

// Inspect all active entitlements
const all = await entitlements.getAll();
// e.g. ["sync:settings", "ai:chat"]
```

---
