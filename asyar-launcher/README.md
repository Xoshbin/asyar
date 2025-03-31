# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

## Features

*   **Application Launcher:** Quickly find and launch installed applications.
*   **Command Execution:** Run custom commands defined by extensions.
*   **Extensible:** Add new functionality through a simple extension API. (See `docs/extension-development.md` for more details - *Note: This doc might need updating based on recent refactoring*).
*   **Clipboard History:** (Via built-in extension) Access and search your clipboard history.
*   **Modern Tech Stack:** Leverages the speed and safety of Rust (Tauri backend) and the efficiency of SvelteKit (frontend).

## Development Setup

### Prerequisites

*   [Node.js](https://nodejs.org/) (which includes npm)
*   [Rust](https://www.rust-lang.org/tools/install) and Cargo
*   Tauri prerequisites (see [Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites))

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
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

*   **Development Mode:**
    ```bash
    pnpm tauri dev
    # or npm run tauri dev
    ```
*   **Building for Production:**
    ```bash
    pnpm tauri build
    # or npm run tauri build
    ```

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).
