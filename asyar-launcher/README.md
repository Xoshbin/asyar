# Asyar

**An open-source alternative to Raycast.**

Asyar is a fast, extensible command launcher built with modern web technologies. It allows you to quickly search for applications, run commands, access clipboard history, and much more through a growing ecosystem of extensions.

Built with [Tauri](https://tauri.app/), [SvelteKit](https://kit.svelte.dev/), and [TypeScript](https://www.typescriptlang.org/).

## Features

*   **Application Launcher:** Quickly find and launch installed applications.
*   **Command Execution:** Run custom commands defined by extensions.
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
