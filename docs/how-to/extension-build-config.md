# Build extension workers without DOM polyfills

Use the SDK's Node-only `asyar-sdk/vite` helper with Vite 6. Runtime code continues
importing `asyar-sdk/contracts`, `asyar-sdk/worker`, or `asyar-sdk/view`; the bare
`asyar-sdk` import remains unsupported.

```ts
import { defineExtensionConfig } from 'asyar-sdk/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';

export default defineExtensionConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  config: { plugins: [svelte()] },
});
```

The helper discovers `worker.html` and `view.html`, emits deterministic
`worker.js`/`view.js` entries into `dist`, uses relative asset URLs, and disables
`build.modulePreload`. Preload hints offer little benefit in on-demand view
iframes, while HTML's default modulepreload polyfill crashes headless workers.
The separate Vite dynamic-import preload helper may retain guarded DOM references;
those are safe during module evaluation and are not the crashing polyfill.

Set `worker: false` or `view: false` to exclude an entry, or provide an alternative
HTML filename. Use `raycastCompat: true` for the local Raycast adapter, or pass its
directory as a string. The adapter's source and React dependencies must be
available. Extension-specific settings go in `config`; shared output naming,
entry selection, relative base, and preload policy stay owned by the helper.
Workspace SDK sources are detected at `../../asyar-sdk/src`; `sdkSource` can
specify another location.

## Temporary compatibility and privacy

Before launcher 0.2.0, a worker that fails during startup can recover in the
existing sandboxed worker iframe. Startup failures log the extension ID and the
remedy `modulePreload: false`. Recovery does not immediately show a crash;
iframe load errors and uncaught exceptions still use existing failure feedback.
Errors after worker readiness do not trigger this fallback. Invalid module paths
also fail directly. A metadata test enforces removal before 0.2.0 ships.

Fallback attempts are aggregated locally in `usage.db` as
`(worker_fallback, extension_id, local_day, count)`. The existing server payload
has no fallback field, so these counts are intentionally local-only. They are
excluded from launch totals, walkthrough history, network payloads, and pending
usage-send selection. No new egress path or per-event request is introduced;
usage-sharing consent behavior is unchanged.

To inspect local counts, query a copy of the application's `usage.db`:

```sql
SELECT target, day, count
FROM usage_events
WHERE event_type = 'worker_fallback'
ORDER BY day DESC, target;
```

## Maintainer acceptance script

1. Use a newly packaged launcher and the rebuilt Coffee extension. Run
   **Caffeinate**, then **Caffeination Status**: verify the status actually changes
   and sleep prevention becomes active. Run **Decaffeinate** and confirm it stops.
   Confirm no Coffee iframe fallback appears in the logs. Absence of a toast alone
   is not acceptance.
2. Install an unchanged published third-party worker extension, preferably Steam
   on Windows (171 installs in the store screenshot). Confirm its published
   worker bundle contains the old unguarded modulepreload polyfill first. If it
   does not, select another affected published bundle or an unchanged pre-fix
   test bundle; do not claim fallback acceptance from a clean bundle.
3. Enable that extension and execute a background command. For Steam, run
   **Reindex Steam Games**, verify installed games appear, and launch one. Confirm
   the log names `dev.dose.steam`, says `iframe fallback`, and includes
   `modulePreload: false`. Confirm successful recovery has no crash feedback.
4. Hide and reveal the launcher several times. Confirm background commands still
   work and the extension's state persists. Disable/re-enable the extension and
   verify that one iframe is mounted per current mount token.
5. With usage sharing off, repeat a fallback startup. Confirm a local daily count
   increments and no usage request is emitted. With sharing enabled, confirm
   ordinary usage sends contain no fallback identifiers or counts.
6. With a deliberately broken worker iframe in a test extension, confirm load
   failure or an uncaught exception still produces visible failure feedback.

Publishing extensions and running this acceptance script belong to the maintainer.

## Implementation evidence (2026-10-04)

The repository manifest audit in the handoff found workers in Steam, Home
Assistant, Contacts, and Shepherd Sessions: 265 of the five third-party entries'
268 installs in the store screenshot. Published store bundles remain unverified.

Coffee was rebuilt once with its original config before migrating any extension.
Its `worker.js` imported `assets/manifest-CVY_KhoI.js`, which began with the
unguarded `document.createElement("link").relList` polyfill. After migration, the
imported manifest chunk is `assets/manifest-Dux6de87.js`: that polyfill is absent.
Its separate preload helper starts with a `typeof document` guard. The fixture
regression evaluates the emitted worker and every static/dynamic imported chunk
without DOM globals, catches the original build failure, and passes with the
factory.

All 20 local extension Vite configs now use the factory. The 13 Svelte extensions
rebuilt successfully: Apple Shortcuts, Browser, Coffee, Color Picker, Pomodoro,
Speed Test, Tauri Docs, World Cup, Emoji, Kill Process, Memory, Google Translate,
and SDK Playground. The seven Raycast conversions' Vite builds are blocked by
missing `packages/raycast-compat/src/index.ts`; their original package build
scripts also target Raycast tooling rather than these Vite configs. Restoring
that adapter checkout is outside this change. The factory's Raycast alias policy
is covered by a fixture test.

`extensions/` is gitignored, so these 20 config migrations do not appear in the
monorepo diff. A review patch is saved at
`/private/tmp/asyar-worker-vite-configs.patch`; original configs and Coffee's
pre-fix bundle are under `/private/tmp/asyar-worker-polyfill-configs/`. Build logs
and CI logs use `/private/tmp/asyar-worker-*` and `/private/tmp/asyar-rebuild-*`.

The leftover `asyar-launcher/src-tauri/built-in-features.bak/` directory still
exists and was left untouched. No extensions were published, no app was launched,
and no benchmarks were run.

Final verification passed: `pnpm check:ci` with system access (the sandboxed run
failed environment-dependent Rust tests), `cargo test --workspace` (3,813 passed),
`cargo clippy --workspace --all-targets -- -D warnings`, SDK build and tests
(765 passed), and `git diff --check`. The launcher type check reported zero errors
and 13 warnings. Packaged/live acceptance remains for the maintainer.
