---
name: architectural-integrity
description: Use before planning or implementing ANY feature, bug fix, refactor, or API change that touches Asyar's architecture — extension system, service layer, IPC contracts, Tauri commands, manifest contributions, or cross-layer data flow. Triggers on new features, new extension APIs, new services, bug fixes involving multiple layers, refactors of infrastructure code, adding new contribution points, and any work that could affect how built-in features or third-party extensions interact with the platform. Also triggers on any task where you need to decide which architectural layer owns the logic, whether Tier 2 extensions can use a capability, or whether a change requires a manifest/permission update. Does NOT trigger for pure CSS/styling fixes (use design-language), isolated unit tests, documentation updates, version bumps, mechanical renames, or answering informational questions about the codebase.
---

# Architectural Integrity

Asyar is a platform, not an app. Every decision — features, bug fixes, refactors — must be made from a platform-level perspective. The architecture is inspired by VS Code's extension host model: the core app is a thin, stable shell that consumes capabilities from extensions through well-defined interfaces.

## Beta Phase Mindset

Asyar is in Beta. This changes everything about how you approach code:

- **Backward compatibility is irrelevant.** Do not write bloated code, shims, or temporary hacks to support older versions of anything — APIs, data formats, extension manifests, IPC contracts. If a clean design requires a breaking change, make the breaking change.
- **Breaking changes are encouraged** when they result in cleaner, more scalable infrastructure. A clean break now saves years of workarounds later.
- **Prioritize clean code over legacy API contracts.** If an existing interface is wrong, redesign it. Do not patch around it.

This applies everywhere: internal module boundaries, Tauri commands, frontend services, extension APIs, IPC message formats, data schemas.

---

## Principle 1: Process Isolation & Extension Hosts

### The Pattern

All features might eventually be extended by third parties. Design every capability as if an extension will need to use it — because one will.

Asyar already implements this with its **Two-Tier Extension Model**:

- **Tier 1 (Built-in features)** run in the privileged host context at `src/built-in-features/*/`. They share the main JS execution context with full Tauri API access.
- **Tier 2 (Installed extensions)** run in **two sandboxed `<iframe>` elements per extension** (worker + view) at the `asyar-extension://` custom protocol. They communicate exclusively via `postMessage` IPC. A misbehaving Tier 2 extension cannot crash the host. The worker is always-on (push subscriptions, schedules, timers, tray, RPC handlers); the view is on-demand UI. See [`docs/explanation/extension-runtime.md`](../../../docs/explanation/extension-runtime.md).

This was a hard-learned lesson. The early implementation tried `import()` to load Tier 2 extensions directly into the host window. It failed in three ways: duplicate MessageBroker singletons, `window.parent === window` breaking postMessage routing, and lost extensionId context. The iframe model solved all three by giving each extension a genuinely separate JS execution context. Phase 6 split the single iframe into worker + view to fix the silent-push-drop class of bugs that the dispatch-evicted single iframe caused.

### How to Apply This

When building a new search engine, background task, data provider, or any capability:

1. **Design a generic interface first** — like `SearchProvider`, `Extension`, or `ICommandService`. The core app consumes data through this interface.
2. **The core app is a consumer, not an implementor.** It orchestrates and renders. The actual logic lives behind the interface.
3. **Never tightly couple the main UI thread with extension execution logic.** If you're writing code that only works when called directly from a Svelte component and cannot be invoked over IPC, you're creating a Tier-1-only feature. That's a design smell.

### Real Asyar Examples

**Good — SearchOrchestrator as a consumer:**
The `SearchOrchestrator` at `src/services/search/searchOrchestrator.svelte.ts` doesn't implement search. It aggregates results from the Rust search engine and from `extensionManager.searchAll(query)`. Any extension implementing the `search()` method automatically contributes results. The orchestrator doesn't care where results come from.

**Good — ExtensionIpcRouter as a generic dispatcher:**
The `ExtensionIpcRouter` at `src/services/extension/ExtensionIpcRouter.ts` routes `asyar:api:{service}:{method}` messages to service instances via a service registry. Adding a new service doesn't require changing the router — just register the service.

**Good — sync_application_index, after the fix:**
The `sync_application_index` Tauri command at `src-tauri/src/commands/applications.rs` used to carry 40+ lines of diffing, indexing, and state mutation directly in the handler. It now parses its arguments and delegates: `service::sync_application_index(&app, &search_state, paths)`. Copy this shape — the handler converts wire types, the service module owns the logic.

### VS Code Parallel

VS Code's Extension Host runs in a separate process. Extensions never touch the UI thread's DOM. They communicate through a well-defined protocol. Even built-in features like Git, TypeScript language support, and Markdown preview are implemented as extensions using the same API surface as third-party extensions. This is the gold standard.

---

## Principle 2: Declarative Contribution Points

### The Pattern

Instead of hardcoding features into the UI, features register themselves through a contribution system. Internal features and third-party extensions use the exact same API to inject their capabilities.

Asyar already has this through `manifest.json`:

```json
{
  "id": "org.asyar.pomodoro",
  "type": "extension",
  "background": { "main": "dist/worker.js" },
  "commands": [
    {
      "id": "start-timer",
      "name": "Start Pomodoro",
      "mode": "background",
      "icon": "▶️"
    }
  ],
  "permissions": ["notifications:send", "clipboard:write", "storage:read", "storage:write"],
  "searchable": true
}
```

Commands declared in the manifest are automatically indexed into the Rust search engine with the format `cmd_{extensionId}_{commandId}`. They appear in search results without any UI code changes. Permissions are validated at discovery time, not runtime. Platform compatibility is enforced before extension code ever loads.

### How to Apply This

When adding a new system command, menu item, search source, or UI contribution:

1. **Check if a contribution point already exists.** Commands go in `manifest.json`. Search capabilities are declared with `searchable: true`. Permissions are declared in the `permissions` array.
2. **If no contribution point exists, create one.** Design it as a generic registration mechanism, not a one-off addition. The new feature should register itself the same way a third-party extension would.
3. **Never manually edit core UI components to add a feature.** If you're adding an `if (featureId === 'my-feature')` branch in the core renderer, you're doing it wrong. The core should be feature-agnostic.

### Real Asyar Examples

**Good — Command index sync is manifest-driven:**
The `syncCommandIndex()` method in `extensionManager.svelte.ts` formats all commands as `cmd_{extensionId}_{commandId}` and syncs them to the Rust search index. New extensions automatically appear in search. No core UI changes needed.

**Good — Extension search aggregation:**
Any extension with `searchable: true` in its manifest has its `search()` method called during query execution. The Calculator, Snippets, and Shortcuts extensions all contribute search results through the same mechanism. No special-casing in the search pipeline.

**Good — Extension storage as a platform service:**
Extensions persist data via `context.proxies.storage` (SDK `IStorageService` interface). The IPC Router auto-injects the calling `extensionId`, so each extension's data is isolated at the SQL level (`WHERE extension_id = ?`). The Rust `storage::extension_kv` module stores all extensions' data in one shared `extension_storage` table in `asyar_data.db`. On uninstall, `lifecycle.rs` calls `extension_kv::clear(extension_id)` — no orphaned data. Permissions: `storage:read` / `storage:write` in `manifest.json`.

**Anti-pattern to avoid — Hardcoded settings tabs:**
The settings page at `src/routes/settings/` uses a hardcoded tab array. If a new settings section needs adding, it requires editing the core settings component. A better approach: extensions declare settings contributions in their manifest, and the settings UI renders them dynamically.

### VS Code Parallel

VS Code's `package.json` `contributes` field is the canonical example. Extensions declare commands, menus, keybindings, views, settings, languages, themes, and more — all without touching VS Code's source. The core UI reads these declarations and renders accordingly. Asyar's `manifest.json` serves the same purpose.

---

## Principle 3: Strict Layered Architecture

### The Pattern

Backend logic must not bleed into UI presentation. Each layer has a clear responsibility:

```
┌─────────────────────────────────┐
│  UI Layer (Svelte components)   │  See: design-language skill
├─────────────────────────────────┤
│  Service Layer (TS services)    │  Orchestration & state ownership
├─────────────────────────────────┤
│  IPC Layer (commands.ts, IPC    │  See: review-ipc skill
│  Router, MessageBroker)         │
├─────────────────────────────────┤
│  Rust Command Layer (commands/) │  Thin wrappers only
├─────────────────────────────────┤
│  Rust Service Layer             │  See: rust-first skill
│  (search_engine/, extensions/)  │
├─────────────────────────────────┤
│  System/OS Layer                │  Hotkeys, tray, filesystem, DB
└─────────────────────────────────┘
```

Data flows down through these layers via well-defined interfaces. Each layer depends only on the layer directly below it.

### How to Apply This

This skill focuses on the _structural_ question: are layers properly separated, and are the interfaces between them generic enough for any consumer (built-in or third-party)?

For rules about _what logic belongs in Rust vs. the frontend_, see the **rust-first** skill. For _correct Svelte 5 and Tauri 2 API usage_ at each layer, see the **tech-versions** skill.

### Real Asyar Examples

**Good — Extension uninstall as thin wrapper:**
The `uninstall_extension` command at `src-tauri/src/commands/extensions.rs` extracts state and delegates to `extensions::lifecycle::uninstall()`. The command layer is just plumbing — all logic lives in the service module. Any future caller (a CLI tool, a headless test, another Rust module) can reuse the same service function.

**Good — Service interfaces with typed contracts:**
`SettingsService` at `src/services/settings/settingsService.svelte.ts` implements `ISettingsService`. UI components consume the interface, not the concrete class. Swapping the implementation doesn't affect consumers — the layer boundary holds.

**Bad — sync_snippets_to_rust contains business logic:**
The `sync_snippets_to_rust` command at `src-tauri/src/commands/snippet_commands.rs` clears and rebuilds a HashMap directly in the command handler. This should delegate to a `snippets::service::sync()` function. The command layer should never own transformation logic.

**Bad — UI components calling Tauri commands directly:**
When a Svelte component calls `commands.checkSnippetPermission()` directly instead of routing through a service, it bypasses the service layer and tightly couples the UI to the IPC contract.

### VS Code Parallel

VS Code's architecture has a strict process boundary: the renderer process (UI), the main process (orchestration), and extension host processes (logic). The renderer never runs extension code. The main process mediates all communication. This process boundary enforces layer separation at the OS level — you literally cannot violate it.

---

## Principle 4: Anti-Patterns to Reject

### Never Pass Raw UI Components to Extensions

Early extensible platforms tried passing DOM access or UI framework components directly to extensions. This tightly couples extensions to the host's internal framework and breaks constantly when the host upgrades.

**Asyar's correct approach:** Tier 2 extensions get sandboxed iframes and communicate through `postMessage` IPC. They cannot touch the host's DOM or internal Svelte components. This is exactly how VS Code's Webview API works — extensions provide HTML content rendered in a sandboxed frame, but never access the host's Electron renderer DOM.

**For data-driven UI (like lists and trees):** Use declarative data structures. The extension provides data (title, icon, description, actions); the host renders it in the standard UI. This is the pattern behind `ExtensionResult[]` returned from `search()` — the extension describes results, the host renders them in `ResultsList`.

For the specific design tokens, components, and styling rules that apply to both host and extension UI, see the **design-language** skill.

### Never Fix Symptoms — Fix Infrastructure

If a bug's root cause is a flaw in the infrastructure design, do not apply a localized patch. Tear down the bad infrastructure and rebuild it cleanly.

**Example:** If the search system has a bug because extension results aren't properly ranked, don't add a special-case sort hack in the UI. Fix the ranking logic in the Rust `search_engine` or in `SearchOrchestrator`'s aggregation. If the ranking interface is fundamentally wrong, redesign it.

**Example:** If an IPC message isn't reaching an extension, don't add a retry loop in the component. Trace the message through `MessageBroker` → `ExtensionIpcRouter` → permission gate → service dispatch. Find the actual failure point and fix the contract.

Since Asyar is in Beta, you have full permission to make breaking changes to fix root causes. There is no excuse for symptom patching.

### Never Hardcode What Should Be Registered

If you find yourself writing a `switch` statement or `if/else` chain that checks for specific extension IDs, feature names, or command types — stop. You're hardcoding what should be dynamically registered.

**Case study — the service registry.** Until early 2026, the registry mapped PascalCase class names to service instances:

```typescript
this.serviceRegistry = {
  LogService: logService,
  NotificationService: new NotificationService(),
  ClipboardHistoryService: ClipboardHistoryService.getInstance(),
  StorageService: extensionStorageService,
  // ... hardcoded list
};
```

Two problems: the class name leaked into the wire contract (renaming `LogService` silently broke every extension), and the list was unchecked — nothing stopped a future contributor from adding `'MyNewService'` and recreating the anti-pattern.

**The fix is a two-layer mechanical guard:**

1. **`asyar-sdk/src/ipc/namespaces.ts`** is the single source of truth. The `NAMESPACES` readonly array lists every valid wire namespace; the `Namespace` union type is derived from it.
2. **`defineServiceRegistry()`** at `asyar-launcher/src/services/extension/defineServiceRegistry.ts` is a typed identity function whose parameter extends `Partial<Record<Namespace, unknown>>`. Passing a non-canonical key is a compile error. The registry itself is composed in `asyar-launcher/src/services/extension/buildServiceRegistry.ts`.

```typescript
return defineServiceRegistry({
  log: logService, // canonical lowercase key IS the wire namespace
  clipboard: clipboardHistoryService, // module singleton — see service-singletons
  commands: commandService,
  actions: actionService,
  // MyNewService: x,                    // compile error
});
```

The key IS the wire namespace (`asyar:api:<namespace>:<method>`). Renaming the backing class never breaks the wire. Adding a new namespace is a single edit to `NAMESPACES` followed by compile errors pointing at every place that needs updating.

**Generalize the principle:** wherever you find yourself maintaining a hardcoded list of strings that must stay in sync with a typed surface, apply the same shape — a single source-of-truth constant, a type derived from it, and an identity helper that constrains consumers to that type. For the full namespace contract, read `asyar-sdk/src/ipc/namespaces.ts` (the `NAMESPACES` array) alongside `defineServiceRegistry.ts` and its test. The same shape applied to Rust-derived lists is the subject of the **generated-files** skill.

### Never Let IPC Boundaries Leak Implementation Details

When designing any cross-boundary data flow (Rust↔TS, Host↔Extension, Service↔Component), ensure the contract is clean serializable data. No framework proxies, no class instances, no callbacks that won't survive serialization. If something can't cross a `postMessage` or `invoke()` boundary cleanly, the interface is wrong — redesign it.

For auditing specific IPC contracts, permission gate coverage, and type string consistency, see the **review-ipc** skill.

---

## Session Start Protocol

At the start of every conversation:

1. **Read the task.** Understand what the user is asking for.
2. **Identify which architectural layers are involved.** Refer to the layer diagram above.
3. **Check for architectural violations in the area you'll touch.** Before writing new code on top of bad infrastructure, flag it.
4. **Only then proceed with implementation.**

If the task is purely informational (explaining code, answering a question), the Architectural Impact summary can be brief. But it must exist. Even "This is a read-only investigation — no architectural changes proposed" counts.

---

## Quick Reference: Decision Checklist

Before writing any code, verify:

- [ ] New capability accessible through a generic interface (not hardcoded to one consumer)?
- [ ] Tier 2 extensions could use this through the existing IPC/manifest system?
- [ ] Tauri commands are thin wrappers delegating to service modules?
- [ ] No backward-compatibility shims, feature flags, or deprecation wrappers?
- [ ] New UI contributions registered declaratively (manifest/registry), not hardcoded?
- [ ] Cross-boundary data is clean serializable types (no Proxies, no class instances)?
- [ ] Root cause addressed, not symptoms patched?
