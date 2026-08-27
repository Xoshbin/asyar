# External and local-development binaries

Linux release bundling automatically builds `asyar-summon` and stages it here
with its Rust target-triple suffix. Tauri packages that generated executable as
`asyar-summon`; the staged file remains gitignored.

The runtime binaries described below remain local-development conveniences and
are not bundled.

Asyar no longer bundles `bun`, `uv`, or `claude` at build time — they're
downloaded on demand at runtime by `RuntimeManager`
(`asyar-launcher/src-tauri/src/runtimes/`), the first time a feature or
extension actually needs one, behind a consent dialog and a pinned sha256
check.

Only `.gitkeep` and this `README.md` are tracked — anything else placed here
is gitignored.

## Why this directory still exists

For local `tauri dev` convenience, the AI Extension Builder's
`resolve_bun`/`resolve_claude` (`asyar-launcher/src-tauri/src/ext_builder/process.rs`)
still check this directory _before_ falling through to `RuntimeManager`'s
download tier. (MCP server resolution does not use this directory — it goes
straight from a system-PATH check to `RuntimeManager`.) If you're doing
repeated local ext-builder testing and don't want to trigger the on-demand
download every time, you can place a real `bun`/`claude` binary here
manually, named with the Rust target triple suffix:

| Platform       | bun / claude suffix            |
| -------------- | ------------------------------ |
| macOS arm64    | `-aarch64-apple-darwin`        |
| macOS x86_64   | `-x86_64-apple-darwin`         |
| Linux x86_64   | `-x86_64-unknown-linux-gnu`    |
| Linux arm64    | `-aarch64-unknown-linux-gnu`   |
| Windows x86_64 | `-x86_64-pc-windows-msvc.exe`  |
| Windows arm64  | `-aarch64-pc-windows-msvc.exe` |

e.g. `bun-aarch64-apple-darwin`. This is purely a local convenience. The global
`tauri.conf.json` does not declare these runtime binaries as `externalBin`.

## Why these runtimes?

- **bun** — replaces `npx` (`bun x`) and `node` (`bun run`) so npx-based MCP
  servers work without a Node.js installation, and runs the AI Extension
  Builder's sidecar JS.
- **uv** — replaces `uvx` (`uv tool run`) and `python`/`python3`
  (`uv run python --`) so Python-based MCP servers work without a Python
  installation.
- **claude** — the native Claude Code runtime the AI extension builder spawns
  via the Agent SDK (`pathToClaudeCodeExecutable`).

When a system `node`, `python`, `npx`, or `uvx` is found on PATH, Asyar uses it
directly and these runtimes are never needed.
