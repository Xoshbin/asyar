# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri v2](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

![Asyar Demo](https://raw.githubusercontent.com/Xoshbin/asyar/main/asyar-launcher/docs/asyar.s.gif)

---

> **Note:** Asyar is under active development and is not yet considered stable or production-ready. You may encounter bugs or breaking changes. Contributions are welcome!

---

## Features

- **Application Launcher** — Quickly find and launch installed applications
- **Command Execution** — Run custom commands defined by extensions
- **Silent AI Commands** — Bind a hotkey to an agent and have its response replace your text selection in place — no launcher window, no confirm dialog. Ideal for grammar fixes, translations, or any one-shot transform
- **Live Tray Menu** — Extensions can register real-time status items in the system tray
- **Highly Extensible** — Tier 1 (privileged built-ins) and Tier 2 (sandboxed) extension architecture; every Tier 2 extension runs as an always-on worker iframe plus an on-demand view iframe so background work survives the launcher closing
- **Clipboard History** — Access and search your clipboard history natively
- **Extension Store** — Browse, install, and publish extensions at [asyar.org](https://asyar.org)
- **Cross-Platform** — natively supported across macOS, Windows, and Linux

## OS Support Matrix

| Feature | macOS | Windows | Linux (X11)* |
|---------|-------|---------|--------------|
| Spotlight | ✅ | ✅ | ✅ |
| Applications | ✅ | ✅ | ✅ |
| Application Icons | ✅ | ✅ | ✅ |
| Calculator | ✅ | ✅ | ✅ |
| Clipboard History | ✅ | ✅ | ✅ |
| Create Extension | ✅ | ✅ | ✅ |
| Portals | ✅ | ✅ | ✅ |
| Shortcuts | ✅ | ✅ | ✅ |
| Snippets | ✅ | ✅ | ✅ |
| Store | ✅ | ✅ | ✅ |
| Installed Extensions | ✅ | ✅ | ✅ |

> * **Note on Linux Wayland:** Global input-heavy features like Snippets do **not** work on Wayland (e.g., default Ubuntu 22.04+, Fedora 25+, KDE Plasma 6).

### Detailed Platform Compatibility

*(Asyar is fully tested and verified on **macOS**, **Windows 11**, and **Debian**)*

- **macOS:** Fully supported and tested. Global features like Snippets require Accessibility permissions.
- **Windows:** Fully tested on Windows 11. Supported on Windows 10 out-of-the-box. (Windows 7/8 may work but are untested).
- **Linux (X11):** Fully tested on Debian. Supported on all other X11 sessions (e.g., Mint, MATE, Xfce, Ubuntu on Xorg).
- **Linux (Wayland):** ❌ Not supported for global hooks. *Workaround: Log out and select an "Xorg" or "X11" session at your login screen.*

## Repository Layout

This is a pnpm monorepo containing both the desktop app and the extension SDK:

```
asyar/
├── asyar-launcher/       # Desktop application (Tauri + SvelteKit)
├── asyar-sdk/            # SDK + CLI for extension developers (published to npm as `asyar-sdk`)
├── extensions/           # Local Tier 2 extension clones (created on demand by setup.mjs)
├── scripts/              # Orchestration: dev.mjs, build-all.mjs, check.mjs
├── setup.mjs             # One-command development setup
├── pnpm-workspace.yaml   # Workspace package list
└── package.json          # Root scripts and shared pnpm config
```

The workspace uses pnpm to **symlink** `asyar-sdk` into the launcher and any extension under `extensions/`. Edit SDK source, rebuild, and changes are instantly available everywhere — no manual copying.

## Quick Start

### For Extension Developers

You don't need the workspace. Install the CLI and start building:

```bash
npm install -g asyar-sdk
asyar --version
```

See the [Extension Development Guide](asyar-launcher/docs/extension-development.md) for the full walkthrough.

### For Core Contributors

Clone this repo and run the setup script — it installs everything and pulls in any optional Tier 2 sample extensions:

```bash
git clone https://github.com/Xoshbin/asyar.git
cd asyar
node setup.mjs
```

The setup script will:
1. Verify Node.js 20+, pnpm 9+, and Rust are installed
2. Create the `extensions/` directory and clone the `sdk-playground` sample extension
3. Run `pnpm install` (links the in-tree SDK across the workspace)
4. Download the bundled MCP sidecar binaries (`bun` and `uv`)
5. Build any cloned extensions and attach them
6. Run `asyar doctor` to verify the setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri v2 platform prerequisites:
  - macOS: [Tauri macOS setup](https://tauri.app/start/prerequisites/#macos)
  - Windows: [Tauri Windows setup](https://tauri.app/start/prerequisites/#windows)
  - Linux: [Tauri Linux setup](https://tauri.app/start/prerequisites/#linux)

## Daily Commands

From the workspace root:

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Build SDK once, then start the app in dev mode with SDK watch |
| `pnpm build` | Full clean production build (SDK + Tauri release bundle) |
| `pnpm build:all` | Build SDK + launcher frontend in dependency order |
| `pnpm check` | Run `asyar doctor` + `svelte-check` |
| `pnpm changeset` | Record a changeset for the next SDK release |

You can also use the individual package commands directly:

| Directory | Command | What it does |
|-----------|---------|-------------|
| `asyar-sdk/` | `pnpm run build:all` | Rebuild SDK types + CLI |
| `asyar-launcher/` | `pnpm tauri dev` | Start the app (SDK must be built) |
| `asyar-launcher/` | `pnpm run check` | Run svelte-check on the launcher |

## Releasing

The launcher and SDK release independently:

- **Launcher:** Push a `v*` tag (e.g., `v0.1.2`); the `Release Launcher` workflow builds the full Tauri matrix (macOS universal, Windows x64/arm64, Linux amd64/arm64), signs, notarizes, creates a GitHub Release, and notifies the asyar.org updater feed. See [`asyar-launcher/RELEASING.md`](asyar-launcher/RELEASING.md) for the versioning helper script.
- **SDK:** Commit a `pnpm changeset` describing your change. On push to `main`, the `Release SDK` workflow opens a "Release asyar-sdk" PR; merging it auto-publishes to npm.

## Diagnosing Issues

```bash
cd asyar-sdk && node dist/cli/index.js doctor
```

Expected output:

```
Asyar Doctor

  ✓ SDK build: dist/ is up to date
  ✓ SDK link: workspace-linked
  ✓ Extensions dir: found
  ✓ Store: https://asyar.org is reachable
  ✓ Monorepo: detected
```

## Contributing

Contributions are welcome! For an overview of how the system works, start with the [launcher architecture docs](asyar-launcher/docs/). The Tier 2 extension model (worker iframe + view iframe split, postMessage broker, manifest schema) is documented at [`asyar-launcher/docs/explanation/extension-runtime.md`](asyar-launcher/docs/explanation/extension-runtime.md) and [`asyar-launcher/docs/explanation/ipc-bridge.md`](asyar-launcher/docs/explanation/ipc-bridge.md).

## License

Distributed under the AGPLv3 License. See [LICENSE](LICENSE) for the full text. Both `asyar-launcher/` and `asyar-sdk/` are AGPL-3.0.
