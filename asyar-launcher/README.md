# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

![Asyar Demo](docs/asyar.s.gif)

---

**⚠️ Disclaimer: Not Production Ready ⚠️**

**Asyar is currently under active development and is NOT considered stable or production-ready.** The codebase is evolving, and you may encounter bugs or breaking changes. The code is also in need of significant refactoring. Use at your own risk!

---

## Features

*   **Application Launcher:** Quickly find and launch installed applications.
*   **Command Execution:** Run custom commands defined by extensions.
*   **Live tray menu items:** Extensions can register real-time status items (e.g., "🍅 18:32") in the macOS menu bar.
*   **Highly Extensible (Tier 1 & Tier 2 Architecture):** Add new functionality through a secure extension API.
*   **Clipboard History:** (Via built-in extension) Access and search your clipboard history natively.
*   **Modern Tech Stack:** Leverages the speed and safety of Rust (Tauri backend) and the efficiency of SvelteKit (frontend).

## Extension Architecture

Asyar features a dual-tier extension architecture to balance extreme performance for core features with strict security for third-party code:

*   **Tier 1: Built-in Extensions** (e.g., Clipboard History, Store)
    *   Bundled directly with the application source code.
    *   Execute natively in the Privileged Host Window context alongside Asyar core services.
    *   No IPC or sandbox overhead; UI navigation and commands run synchronously at maximum speed.
*   **Tier 2: Installed Extensions** (e.g., extensions downloaded from the Store)
    *   Execute strictly within isolated, secure `<iframe>` sandboxes.
    *   Cannot access Host Window properties, the DOM, or unproxied APIs.
    *   Communicate with the Host application exclusively via a simulated `MessageBroker` IPC layer.

## Development Setup

Asyar uses a **pnpm workspace** to link the app, SDK, and extensions together. Each repository is cloned separately but managed as a local workspace so that changes propagate instantly without manual copying.

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) and Cargo
- Tauri v2 platform-specific prerequisites:
  - macOS: Xcode Command Line Tools — see [Tauri macOS setup](https://tauri.app/start/prerequisites/#macos)
  - Windows: Visual Studio Build Tools + WebView2 — see [Tauri Windows setup](https://tauri.app/start/prerequisites/#windows)
  - Linux: System dependencies — see [Tauri Linux setup](https://tauri.app/start/prerequisites/#linux)

### Recommended Project Layout

Create a parent directory and clone each repo as a sibling:

```
Asyar-Project/             # workspace root (not a git repo)
  ├── pnpm-workspace.yaml  # links the packages together
  ├── package.json         # root orchestration scripts
  ├── scripts/             # dev.mjs, build-all.mjs, check.mjs
  ├── asyar/               # git clone https://github.com/Xoshbin/asyar.git
  ├── asyar-sdk/           # git clone https://github.com/Xoshbin/asyar-sdk.git
  └── extensions/          # your Tier 2 extension projects
      ├── my-extension/
      └── ...
```

### First-Time Setup

```bash
# 1. Create the workspace directory
mkdir Asyar-Project && cd Asyar-Project

# 2. Clone the repos
git clone https://github.com/Xoshbin/asyar.git
git clone https://github.com/Xoshbin/asyar-sdk.git
mkdir -p extensions

# 3. Create the workspace root files (see below)

# 4. Install everything — this links the SDK, builds it, and installs all deps
pnpm install
```

**`pnpm-workspace.yaml`:**
```yaml
packages:
  - 'asyar'
  - 'asyar-sdk'
  - 'extensions/*'
```

**`package.json`:**
```json
{
  "name": "asyar-project",
  "private": true,
  "scripts": {
    "dev": "node scripts/dev.mjs",
    "build:all": "node scripts/build-all.mjs",
    "check": "node scripts/check.mjs"
  },
  "engines": { "node": ">=20", "pnpm": ">=9" }
}
```

The orchestration scripts (`scripts/dev.mjs`, `scripts/build-all.mjs`, `scripts/check.mjs`) are cross-platform Node.js scripts included in this repository.

### How the Workspace Works

After `pnpm install`, the SDK is **symlinked** (not copied) into every package that depends on it:

```
asyar/node_modules/asyar-sdk  →  ../../asyar-sdk   (live source)
extensions/*/node_modules/asyar-sdk  →  ../../asyar-sdk
```

This means:
- Edit SDK source → rebuild SDK → changes are instantly available everywhere
- The `asyar` CLI binary always runs from the live SDK, not a frozen npm copy
- The `prepare` script in `asyar-sdk` runs `build:all` automatically on `pnpm install`

### Daily Commands

From the **workspace root** (`Asyar-Project/`):

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Builds SDK, then starts the Asyar app in dev mode |
| `pnpm build:all` | Builds SDK + frontend in dependency order |
| `pnpm check` | Runs `asyar doctor` + `svelte-check` |

From **asyar-sdk/**:

| Command | What it does |
|---------|-------------|
| `pnpm run build:all` | Compiles SDK types + CLI |
| `node dist/cli/index.js doctor` | Diagnoses environment issues |

From **asyar/**:

| Command | What it does |
|---------|-------------|
| `pnpm tauri dev` | Starts the Tauri app in development mode |
| `pnpm run build` | Production build of the frontend |
| `pnpm run check` | Runs svelte-check for type errors |

### Verifying Your Setup

Run `asyar doctor` to check that everything is configured correctly:

```bash
cd asyar-sdk && node dist/cli/index.js doctor
```

Expected output:
```
Asyar Doctor

  OS:        darwin arm64 (...)
  Node:      v20.x.x
  pnpm:      10.x.x

  ✓ SDK build: dist/ is up to date
  ✓ SDK link: workspace-linked → /path/to/asyar-sdk
  ✓ Extensions dir: ~/Library/.../extensions (N extensions)
  ✓ Store: https://asyar.org is reachable
  ✓ Monorepo: root at /path/to/Asyar-Project
```

### Working on Individual Repos

Each repo remains a separate git repository. You can work on them independently:

- **asyar only** — If you only work on the frontend/Tauri side and don't need to modify the SDK, you can clone just `asyar` and `pnpm install` will fetch the SDK from npm (no workspace needed).
- **asyar-sdk only** — Clone the SDK repo and use `pnpm run build:all` to compile. Run `node dist/cli/index.js doctor` to verify.
- **Full workspace** — For core development across both, use the workspace layout above. This is the recommended setup for contributors.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## License

Distributed under the AGPLv3 License. See LICENSE.md for more information.
