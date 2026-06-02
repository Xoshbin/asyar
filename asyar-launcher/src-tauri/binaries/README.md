# Bundled sidecars

This directory holds the `bun`, `uv`, and `claude` binaries that Asyar bundles
so users without Node.js, Python, or Claude Code installed can still run
npx/uvx-based MCP servers and the AI extension builder.

Only `.gitkeep` and this `README.md` are tracked — every binary here is
gitignored and provisioned at build time (they are large and platform-specific).

## Platform-suffix naming (Tauri externalBin convention)

Tauri appends the Rust target triple to the binary name at bundle time. You
must place the binary here with the correct suffix before building:

| Platform      | bun / uv / claude suffix              |
|---------------|---------------------------------------|
| macOS arm64   | `-aarch64-apple-darwin`               |
| macOS x86_64  | `-x86_64-apple-darwin`                |
| Linux x86_64  | `-x86_64-unknown-linux-gnu`           |
| Linux arm64   | `-aarch64-unknown-linux-gnu`          |
| Windows x86_64| `-x86_64-pc-windows-msvc.exe`         |
| Windows arm64 | `-aarch64-pc-windows-msvc.exe`        |

macOS universal builds (`--target universal-apple-darwin`) also need a
`-universal-apple-darwin` binary; the download script produces it by lipo-merging
the two macOS arch builds.

## Populating this directory

Run the download script from the repo root:

```
node scripts/download-sidecars.mjs
```

The script detects your current platform, downloads the appropriate releases,
and renames them to the correct suffixed filenames automatically. CI passes
`--target <triple>` to provision the exact platform it is building.

## Why these sidecars?

- **bun** — replaces `npx` (`bun x`) and `node` (`bun run`) so npx-based MCP
  servers work without a Node.js installation.
- **uv** — replaces `uvx` (`uv tool run`) and `python`/`python3`
  (`uv run python --`) so Python-based MCP servers work without a Python
  installation.
- **claude** — the native Claude Code runtime the AI extension builder spawns
  via the Agent SDK (`pathToClaudeCodeExecutable`). Pulled from
  `downloads.claude.ai` and verified against the per-release SHA-256 manifest;
  pin a version with `CLAUDE_CODE_VERSION=<x.y.z>`.

When a system `node`, `python`, `npx`, or `uvx` is found on PATH, Asyar
uses it directly and those sidecars are never invoked.
