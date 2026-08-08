---
name: service-singletons
description: Use before creating, refactoring, or consuming any service, proxy, bridge, or long-lived registry object in asyar-launcher, asyar-sdk, or extensions. Triggers on new service modules, new SDK proxies, anything that smells like a singleton, refactors that introduce `getInstance()` / `static instance` / `private constructor`, or changes to how services are registered in `buildServiceRegistry`. Also triggers on extension bootstrap code that imports from `asyar-sdk`. Does NOT trigger for pure pure-function utilities, stateless helpers, or Svelte component-level state.
---

# Service Singletons

In April 2026 the codebase was fully normalized to the **module-level singleton** pattern. This decision was deliberate, tested end-to-end (2496 tests green), and released as `asyar-sdk@2.7.0`. This skill exists so future agents don't drift the codebase back into the mixed state it came from.

## The Rule (one sentence)

> **One service = one `export class` + one `export const xxxService = new XxxService()` in the same file. Consumers import the instance. That's it.**

The registry (`buildServiceRegistry.ts`) composes these singletons by identity. `new` appears in the registry **only** when a service needs runtime dependencies the registry uniquely knows — currently just `InteropService`.

## Canonical shape

```typescript
// asyar-launcher/src/services/foo/fooService.ts
export class FooService implements IFooService {
  doThing(): void {
    /* ... */
  }
}

export const fooService = new FooService();
```

```typescript
// asyar-launcher/src/services/extension/buildServiceRegistry.ts
import { fooService } from '../foo/fooService';
// ...
return defineServiceRegistry({
  foo: fooService, // ← always this
  interop: new InteropService({ ...deps }), // ← exception: runtime deps
});
```

## SDK canonical bootstrap

The SDK follows the same rule. `MessageBroker` and `ExtensionBridge` are module singletons — extensions import the instances, not the classes:

```typescript
// extensions/*/main.view.ts (and similarly main.worker.ts, importing from asyar-sdk/worker)
import { extensionBridge, ExtensionContext, registerIconElement } from 'asyar-sdk/view';

const context = new ExtensionContext();
context.setExtensionId(extensionId);
extensionBridge.registerManifest(manifest as any);
extensionBridge.registerExtensionImplementation(extensionId, extension);
```

`MessageBroker` and `ExtensionBridge` are still exported as class identifiers — for _type references only_. Never instantiate them in extension or launcher code; use the `messageBroker` / `extensionBridge` singleton exports. Each iframe (worker + view) has its own pair of singletons — that's expected; the rule "one instance per module" applies per-iframe.

## What NOT to write

### ❌ Gang-of-Four singleton with `.getInstance()`

```typescript
// DO NOT
export class FooService {
  private static instance: FooService;
  private constructor() {}
  public static getInstance(): FooService {
    if (!FooService.instance) FooService.instance = new FooService();
    return FooService.instance;
  }
}
```

Why it's wrong here: ES modules already guarantee one-instance-per-module by spec. The GoF pattern is ~8 lines of scaffolding that re-implements what the language gives you for free, and it leaks the pattern into the class's public surface. We removed every instance of this in April 2026. Don't reintroduce it.

### ❌ `new XxxService()` scattered at call sites

```typescript
// DO NOT
function handleClick() {
  const svc = new FooService(); // fresh instance every call
  svc.doThing();
}
```

If you see this anywhere except the registry-with-runtime-deps exception, it's a bug — state won't be shared, event listeners multiply, etc.

### ❌ `XxxService.getInstance()` in new code

If you're importing from `asyar-sdk/worker`, `asyar-sdk/view`, or `asyar-sdk/contracts` and find yourself writing `ExtensionBridge.getInstance()` or `MessageBroker.getInstance()` — stop. Those static methods no longer exist. Import `extensionBridge` or `messageBroker` directly.

### ❌ Reviving class-name keys in the registry

```typescript
// DO NOT
return defineServiceRegistry({
  NotificationService: new NotificationService(), // PascalCase class name
  FooService: fooService,
});
```

Keys must be canonical lowercase wire namespaces from `asyar-sdk/src/ipc/namespaces.ts`. See the `architectural-integrity` skill's "Never Hardcode What Should Be Registered" section for the history — this was the specific anti-pattern `defineServiceRegistry()` was built to prevent.

## The runtime-deps exception, precisely

Instantiate in the registry only when the service's constructor takes arguments the registry uniquely knows. Today that's exactly one service:

| Service          | Why                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `InteropService` | Takes `hasCommand`, `getManifestById`, `handleCommandAction` callbacks that only the registry can wire |

`NotificationActionBridge` takes callbacks too, but it is **not** a registry entry — extensions never call it over IPC. It is constructed once during startup in `asyar-launcher/src/services/appInitializer.ts`. That is the other legitimate place for constructor injection: a composition root that isn't the registry.

If you find yourself tempted to add a second registry exception, first ask: can those deps be module imports instead? Usually yes. If genuinely not, add it here and document why.

## Test pattern

Tests consume the singleton via `vi.mock()`:

```typescript
vi.mock('../foo/fooService', () => ({
  fooService: { doThing: vi.fn() },
}));

import { fooService } from '../foo/fooService';

it('calls doThing', () => {
  /* ... */
  expect(fooService.doThing).toHaveBeenCalled();
});
```

For tests that need a _fresh_ instance (e.g. testing stateful classes in isolation), `new XxxService()` in the test file is fine — that's what the public constructor is for. Examples: `clipboardHistoryService.test.ts`, `actionService.test.ts`.

## Decision checklist when adding a new service

- [ ] Class `export class XxxService implements IXxxService`
- [ ] Singleton `export const xxxService = new XxxService()` in the _same_ file, at the bottom
- [ ] Registry entry `xxx: xxxService` using a canonical lowercase key from `NAMESPACES`
- [ ] No `static instance`, no `static getInstance()`, no `private constructor`
- [ ] If the service needs runtime deps, instantiate in the registry — and document the reason in a one-line comment

## Red flags — STOP and reconsider

- "I'll just wrap it in getInstance() for safety"
- "Module singletons are too simple, I need proper encapsulation"
- "Let me make the constructor private so no one can misuse it"
- "I'll just instantiate it where I use it, it's only one line"
- "This is an exception because [reason]"

Unless your [reason] is literally "the registry needs to inject runtime-known callbacks," it isn't an exception.

## History

- Before April 2026: three competing patterns coexisted in the codebase — module singleton (majority), GoF `.getInstance()` (ClipboardHistoryService, ActionService, SDK's MessageBroker and ExtensionBridge), and `new` at the registry (NotificationService, OpenerService, NetworkService).
- April 2026: unified to module singletons. SDK bumped to 2.7.0 with breaking changes; all four bundled extensions + create-extension templates updated.
- Tests at the time of landing: **1376 launcher TS + 349 SDK + 771 Rust**, all green; `cargo clippy --lib -D warnings` clean; `cargo doc -D warnings` clean.
