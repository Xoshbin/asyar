# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

---

**⚠️ Disclaimer: Not Production Ready ⚠️**

**Asyar is currently under active development and is NOT considered stable or production-ready.** The codebase is evolving, and you may encounter bugs or breaking changes. The code is also in need of significant refactoring. Use at your own risk!

---

## Current Status & Contributing

The `main` branch represents the current development state. However, the `store` branch is significantly ahead, focusing on implementing an extension store and pushing towards a more stable, production-ready state.

**Contributions are highly welcome!** We especially need help on the `store` branch to improve stability, refactor the codebase, and get Asyar ready for wider use. If you're interested in contributing, please check out the `store` branch.

## Features

- **Application Launcher:** Quickly find and launch installed applications.
- **Command Execution:** Run custom commands defined by extensions.
- **Extensible:** Add new functionality through a simple extension API. See the [Extension Development Guide](docs/extension-development.md) for details on creating your own extensions.
- **Clipboard History:** (Via built-in extension) Access and search your clipboard history.
- **Modern Tech Stack:** Leverages the speed and safety of Rust (Tauri backend) and the efficiency of SvelteKit (frontend).

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (which includes npm)
- [Rust](https://www.rust-lang.org/tools/install) and Cargo
- Tauri prerequisites (see [Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites))

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/USERNAME/asyar.git # Replace with your repo URL
    cd asyar
    ```
2.  Install dependencies:

    ```bash
    # Using pnpm (recommended based on lockfile)
    npm install -g pnpm
    pnpm install

    # Or using npm
    # npm install
    ```

### Running the App

- **Development Mode:**
  ```bash
  pnpm tauri dev
  # or npm run tauri dev
  ```
- **Building for Production:**
  ```bash
  pnpm tauri build
  # or npm run tauri build
  ```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
