# Worker push delivery verification

The host now routes subscription pushes, tray clicks, role-scoped state changes,
preferences, run cancellation, and agent tool invocations through
`postToExtension`. It prefers a mounted Web Worker, retains the worker iframe
compatibility path, and warns when no target exists. Role-scoped state pushes
never fall back to another role. Tool responses enter the shared extension
transport from both window messages and the worker IPC pipeline; matching source
and origin are required before a pending invocation resolves.

The wire-message converter lives separately from delivery so `workerHost` does
not import a module that imports `workerHost`. The selector guard permits worker
iframe queries only in `extensionIframeSelector.ts`; existing scheduler delivery
paths now use that selector for their compatibility lookup.

## Separate missing-worker warning

Could not reproduce the warning about dropping one Playground worker message.
The app was deliberately not launched, as requested. The available October 4
logs did not contain the reported warning or Playground worker mount/fallback
records, so they cannot establish whether that session's worker ever mounted.
The current local Playground manifest specifies `dist/worker.js`; that file and
its static module dependencies exist. The dev URI resolver checks both
`base/dist/<entry>` and `base/<entry>`, so this manifest path resolves to the
existing local file through the second candidate. Dev discovery reads the
manifest directly, and the frontend entry provider supplies `background.main`.

These checks establish the current file-resolution path, not successful runtime
startup. There is insufficient evidence to attribute the warning to stale
`--no-build` output or to a second lifecycle bug. No speculative lifecycle fix
was made. On a recurrence, retain the mount, bootstrap failure, fallback,
ready-ack, unmount, and scheduler-delivery logs for this extension, together with
the linked directory and bundle timestamps.

## Maintainer acceptance script

1. Build the SDK Playground with the current SDK and link it. For a deliberate
   `asyar link --no-build` run, first verify that `dist/worker.js` and its imported
   assets are from that build. Start your usual `pnpm run dev` session.
2. Open the Playground Application Service page. Toggle Launched, Terminated,
   and Frontmost Changed subscriptions off and on. Open a harmless GUI app,
   switch between it and another app, then quit it. Confirm all three counters
   become non-zero and the event log updates.
3. Hide and reveal the launcher, then repeat the application actions. Confirm
   subscriptions continue to work and state reaches the reopened view.
4. Exercise a filesystem watch (or the Shortcuts extension's existing watcher)
   by changing a file in the watched directory. Confirm its counter/log updates.
   Confirm `[fsWatcherBridge] no iframe for …; event dropped` no longer appears.
   A new `no target …; message dropped` warning means a runtime is genuinely
   absent and must be investigated, rather than treated as acceptance success.
5. Click a Playground tray item, change an extension preference, cancel a
   cancellable extension run, and invoke a Playground agent tool. Confirm each
   worker handler receives its message and the tool returns its result.
6. If testing a published HTML worker bundle that triggers compatibility
   fallback, confirm its worker iframe still receives pushes. Confirm ordinary
   view interactions still work while a Web Worker is mounted.

No app launch or benchmark was performed by the implementation agent.
