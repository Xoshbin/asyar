# Bundled sidecars

This directory holds the `bun` and `uv` binaries that Asyar bundles so users
without Node.js or Python can still run npx/uvx-based MCP servers.

## Platform-suffix naming (Tauri externalBin convention)

Tauri appends the Rust target triple to the binary name at bundle time. You
must place the binary here with the correct suffix before building:

| Platform      | bun filename                          | uv filename                           |
|---------------|---------------------------------------|---------------------------------------|
| macOS arm64   | `bun-aarch64-apple-darwin`            | `uv-aarch64-apple-darwin`             |
| macOS x86_64  | `bun-x86_64-apple-darwin`             | `uv-x86_64-apple-darwin`              |
| Linux x86_64  | `bun-x86_64-unknown-linux-gnu`        | `uv-x86_64-unknown-linux-gnu`         |
| Linux arm64   | `bun-aarch64-unknown-linux-gnu`       | `uv-aarch64-unknown-linux-gnu`        |
| Windows x86_64| `bun-x86_64-pc-windows-msvc.exe`      | `uv-x86_64-pc-windows-msvc.exe`       |

## Populating this directory

Run the download script from the repo root:

```
node scripts/download-sidecars.mjs
```

The script detects your current platform, downloads the appropriate releases,
and renames them to the correct suffixed filenames automatically.

## Why these sidecars?

- **bun** — replaces `npx` (`bun x`) and `node` (`bun run`) so npx-based MCP
  servers work without a Node.js installation.
- **uv** — replaces `uvx` (`uv tool run`) and `python`/`python3`
  (`uv run python --`) so Python-based MCP servers work without a Python
  installation.

When a system `node`, `python`, `npx`, or `uvx` is found on PATH, Asyar
uses it directly and these sidecars are never invoked.
