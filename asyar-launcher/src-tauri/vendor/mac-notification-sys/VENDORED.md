# Vendored: mac-notification-sys 0.6.12

Verbatim crates.io sources apart from one fix in `objc/notify.m`, applied via
`[patch.crates-io]` so the `notify-rust`/`tauri-plugin-notification` path
resolves to it too.

Upstream waits for the user to click a notification-with-actions by polling
`while (keepRunning) [runLoop runUntilDate:<now + 0.1 s>]`. `-runUntilDate:`
returns immediately on a run loop with no input sources, and our macOS backend
calls `send()` on a fresh `std::thread` whose run loop is empty — so the wait
busy-spins, pinning a full core per delivered-but-unclicked notification until
the app restarts. The patch parks a dummy `NSMachPort` on the loop so each
poll sleeps until its deadline; delegate callbacks arrive on the main thread
and are picked up on the next poll, as before.

Drop this copy once the fix ships upstream. The deeper cure is migrating to
`UNUserNotificationCenter` with one persistent delegate, which would also fix
upstream's shared-delegate race between concurrent `send()`s.

Other deviations from the registry copy: this file, `README.md` reformatted by
the repo prettier hook, and dropped registry metadata.
