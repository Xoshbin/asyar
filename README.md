# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri v2](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

![Asyar Demo](https://raw.githubusercontent.com/Xoshbin/asyar-launcher/main/docs/asyar.s.gif)

---

> **Note:** Asyar is under active development and is not yet considered stable or production-ready. You may encounter bugs or breaking changes. Contributions are welcome!

---

## Features

- **Application Launcher** — Quickly find and launch installed applications
- **Command Execution** — Run custom commands defined by extensions
- **Live Tray Menu** — Extensions can register real-time status items in the system tray
- **Highly Extensible** — Tier 1 (built-in) and Tier 2 (sandboxed) extension architecture
- **Clipboard History** — Access and search your clipboard history natively
- **Extension Store** — Browse, install, and publish extensions at [asyar.org](https://asyar.org)
- **Cross-Platform** — macOS, Windows, and Linux

## Repositories

| Repo | Description |
|------|-------------|
| [asyar-launcher](https://github.com/Xoshbin/asyar-launcher) | Desktop application (Tauri + SvelteKit) |
| [asyar-sdk](https://github.com/Xoshbin/asyar-sdk) | SDK + CLI for extension developers |
| **asyar** (this repo) | Development workspace and setup |

## Quick Start

### For Extension Developers

You don't need this workspace. Install the CLI and start building:

```bash
npm install -g asyar-sdk
asyar --version
```

See the [Extension Development Guide](https://github.com/Xoshbin/asyar-launcher/blob/main/docs/extension-development.md) for the full walkthrough.

### For Core Contributors

Clone this repo and run the setup script — it pulls everything together:

```bash
git clone https://github.com/Xoshbin/asyar.git
cd asyar
node setup.mjs
```

The setup script will:
1. Clone `asyar-launcher` and `asyar-sdk` as sibling directories
2. Create an `extensions/` directory for local Tier 2 development
3. Generate the pnpm workspace configuration
4. Install all dependencies and build the SDK
5. Run `asyar doctor` to verify the setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- Tauri v2 platform prerequisites:
  - macOS: [Tauri macOS setup](https://tauri.app/start/prerequisites/#macos)
  - Windows: [Tauri Windows setup](https://tauri.app/start/prerequisites/#windows)
  - Linux: [Tauri Linux setup](https://tauri.app/start/prerequisites/#linux)

## Workspace Layout

After setup, the directory looks like this:

```
asyar/                     # this repo (workspace root)
  ├── setup.mjs            # one-command setup script
  ├── pnpm-workspace.yaml  # links packages together
  ├── package.json         # root orchestration scripts
  ├── scripts/             # dev.mjs, build-all.mjs, check.mjs
  ├── asyar-launcher/      # cloned: desktop app
  ├── asyar-sdk/           # cloned: SDK + CLI
  └── extensions/          # local Tier 2 extensions
```

The workspace uses pnpm to **symlink** `asyar-sdk` into all packages that depend on it. Edit SDK source, rebuild, and changes are instantly available everywhere — no manual copying.

## Daily Commands

From the workspace root:

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Build SDK, then start the app in dev mode |
| `pnpm build:all` | Build SDK + frontend in dependency order |
| `pnpm check` | Run `asyar doctor` + `svelte-check` |

You can also use the individual repo commands directly:

| Directory | Command | What it does |
|-----------|---------|-------------|
| `asyar-sdk/` | `pnpm run build:all` | Rebuild SDK types + CLI |
| `asyar-launcher/` | `pnpm tauri dev` | Start the app (SDK must be built) |
| `asyar-launcher/` | `pnpm run check` | Run svelte-check |

## Diagnosing Issues

```bash
cd asyar-sdk && node dist/cli/index.js doctor
```

```
Asyar Doctor

  ✓ SDK build: dist/ is up to date
  ✓ SDK link: workspace-linked
  ✓ Extensions dir: found
  ✓ Store: https://asyar.org is reachable
  ✓ Monorepo: detected
```

## Contributing

Contributions are welcome! See the [Architecture Guide](https://github.com/Xoshbin/asyar-launcher/blob/main/docs/ARCHITECTURE.md) for how the system works.

## License

Distributed under the AGPLv3 License. See [LICENSE](LICENSE) for more information.
