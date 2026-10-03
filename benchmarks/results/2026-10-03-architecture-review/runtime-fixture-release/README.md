# Packaged worker verification

This test fixture declares `dist/daemon/main.js`, intentionally differing from `dist/worker.js`. It uses the real SDK worker and view entries. Build with `node build.mjs` from this directory; generated `dist` files must not be edited.

Use the separate `/private/tmp/asyar-benchmark-apps/fixed/Asyar Dev.app`. Open Settings → Extensions → **Install from File…** and select `../runtime-fixture.asyar`. Restart the fixed app when prompted; approve only its declared storage permissions. Run these checks with benchmarks stopped:

1. Open **Probe Worker Status**. Expect `role: "worker"`, `dom: "undefined"`, `permitted: true`, and a permission-denied message for notes (the fixture declares no notes permission). This is real worker → host service IPC and view → worker RPC.
2. Type **worker probe** in root search. Select **Architecture Worker Probe** and press Enter. Reopen the status view: `actions` must increase. Run **Probe Background Action** and check another increment.
3. Change the extension's **Probe label** preference. The status view's `preferences.label` must update without remounting. Its increasing `ticks` also verifies repeated RPC delivery.
4. Record `runId` and `ticks`, dismiss the launcher with Escape, wait 10 seconds, summon it, and reopen status. Repeat with the launcher's normal input/reset flow. `runId` must stay identical and `ticks` must increase across each hide/show/reset.
5. Disable the extension. Its commands/results must disappear and its worker must terminate. Enable it again: expect a new `runId` and working RPC/actions. Uninstall: commands, worker, and extension storage must be removed. Reinstall/remount: expect a new `runId` and the same successful readiness/service checks.
6. Save the displayed JSON before/after each step and relevant launcher logs under a new `packaged-runtime` folder. A blank view, timeout, unchanged timer, unexpected allowed notes call, or worker startup error is a failure.

These steps are pending; the fixture's presence does not establish packaged-runtime success. Native WebKit module loading was verified separately, using `../fixed/webkit-worker-proof.swift`.

To regenerate the installable package after rebuilding:

```bash
cd /Users/khoshbin/develop/Asyar-Project/benchmarks/results/2026-10-03-architecture-review/runtime-fixture
node build.mjs
zip -FS -qr ../runtime-fixture.asyar manifest.json dist
```
