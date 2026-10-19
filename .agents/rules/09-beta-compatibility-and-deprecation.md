# Beta Compatibility & Deprecation Policy (until 0.2.0)

Asyar is in beta, and third-party extensions are already published in the Asyar Store. Beta means
**internals are free to change, but the contract with published extensions is not, until launcher
`0.2.0`.** This rule replaces the older "backward compatibility is irrelevant" stance.

Everything else about beta is unchanged: SOLID, DRY, root-cause fixes, no symptom patching, and
long-term architecture still decide how code is written. Compatibility is isolated and temporary. It
never shapes the core design.

## 1. What is protected (the third-party contract surface)

A change is **protected** if a published extension, built against an older SDK or manifest schema,
could observe it:

- Extension `manifest.json` schema: fields, values, command and preference definitions, permission names, `role`/`background` semantics.
- Public `asyar-sdk` exports (types, services, methods, signatures, return shapes, error semantics).
- The host↔extension wire contract: `asyar:api:<namespace>:<method>` type strings, `NAMESPACES`, envelope and payload shapes, event names and payloads delivered to extensions. Published extensions **bundle their SDK**, so the host must keep accepting old wire shapes even after the SDK moves on.
- Extension runtime behavior: worker/view roles, `asyar-extension://` protocol, bridge/CSP behavior, the permission gate's allow/deny results for already-declared permissions.
- Extension packaging and store contracts: archive layout, `asyar-ext-builder` output, catalog and registry formats.
- Public deeplinks (`asyar://…`) and persisted extension-owned data (extension storage, preferences) that extensions read back.

**Not protected (break freely, cleanly, no shims):** Tier 1 built-ins and their internals, Tauri
commands used only by the launcher frontend, internal Rust/TS module boundaries, launcher-private
stores and schemas, settings UI, and anything no published extension can reach. Launcher-owned user
data still needs a proper migration so users never lose data. That is normal engineering, not a compat
shim.

## 2. Hard rules for protected surfaces

1. **Additive first.** Introduce the clean new contract beside the old one. Do not mutate or remove the old shape in place.
2. **Deprecate, don't delete.** Every protected thing that is superseded, renamed, or redesigned is marked **deprecated** (see §3) and keeps working until `0.2.0`.
3. **One adapter at the boundary.** Compatibility lives in a single, named adapter at ingress (manifest parsing/normalization, IPC router, SDK re-export). The old shape is normalized into the new one there. The core only ever sees the new shape. Never scatter `if (legacy)` branches through services, components, or Rust domain logic (DRY, single responsibility).
4. **No new features on the old path.** Deprecated APIs are frozen: bug and security fixes only. New capabilities ship on the new contract only.
5. **Security and privacy outrank compatibility.** A compat path must never weaken the permission gate, fail-closed egress (`08-privacy-and-data-egress.md`), sandboxing, or CSP. If keeping an old behavior would open a hole, break it deliberately. Stop and get explicit user approval first, then document the break in the PR text.
6. **Impossible to keep compatible?** Stop and ask the user. Do not silently break the contract and do not silently bolt on a hack. Present the options: adapter, staged deprecation, or approved break.
7. **Pin the old behavior with a test.** Each adapter has a contract test using a realistic old-format fixture (old manifest, old message shape, old SDK call) so the shim's removal at `0.2.0` is a deliberate, visible act.

## 3. How to mark something deprecated

| Layer                                          | Required marking                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript / SDK                               | JSDoc `@deprecated Use <replacement>. Remove in 0.2.0.` on the symbol                                                                                                                                      |
| Rust                                           | `#[deprecated(since = "<ver>", note = "Use <replacement>; remove in 0.2.0")]` where the item is not a specta/wire type, otherwise a doc comment with the same text                                         |
| Manifest field / value                         | Validator accepts it and emits a **deprecation warning** (never an error) naming the replacement. Surfaced by `asyar-ext-builder` and dev tooling. The runtime logs it once per extension, never per call. |
| IPC type string / payload shape                | Router accepts it, normalizes to the new shape, and logs a once-per-extension deprecation notice                                                                                                           |
| Compat code (any adapter, branch, or fallback) | Marker comment `// COMPAT(remove in 0.2.0): <what, and which published extensions need it>`. Follow the exact `remove in X.Y.Z` form used in `workerHost.svelte.ts`, so a deadline guard can parse it.     |
| Docs                                           | Add the deprecation to `docs/` extension-author docs (migration note: old to new) in the same change                                                                                                       |

Every compat adapter also gets a **deadline guard test** modeled on
`services/extension/workerFallbackDeadline.test.ts`. It fails once the launcher `package.json`
version reaches the stated removal version, so nothing outlives the window by accident.

Add each new deprecation to the ledger in §5 in the same change.

## 4. Decision flow before touching any API, schema, or wire shape

1. Could a published extension observe this? **No** → clean break, no shim.
2. **Yes** → design the new contract cleanly, then add the old one as a deprecated adapter (§2–§3).
3. Can't do it additively without compromising security or core design? → stop and ask (§2.6).

## 5. The `0.2.0` removal plan

- Before `0.2.0` ships, **every** `COMPAT(remove in 0.2.0)` marker, deprecated symbol, and adapter is removed, together with its deadline guard and compat tests. The deadline guards enforce this mechanically.
- The SDK removes deprecated exports in the SDK major released alongside launcher `0.2.0`, never earlier. Deprecations themselves ship in ordinary SDK minors.
- Deprecations may extend past `0.2.0` only by an explicit, recorded user decision. Update this rule and the memory entry if the target version moves.
- After `0.2.0`, this document should be revisited: protected surfaces move to normal semver and deprecation windows.

### Active deprecation ledger

| Deprecated item                                                       | Replacement                                                | Location                                                                                                         | Remove in |
| --------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| Iframe compatibility fallback for published HTML-built worker bundles | JS-entry worker bundles (Web Worker)                       | `services/extension/workerHost.svelte.ts`                                                                        | 0.2.0     |
| Pre-#860 `free` launcher anchor (fractions of the monitor's extent)   | `freeTravel` anchor (fractions of available window travel) | `launcher_placement/{types,resolve,classify,service}.rs`, `services/launcher/launcherPlacementService.svelte.ts` | 0.2.0     |
