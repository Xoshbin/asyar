# Contributing to Asyar

Thank you for your interest in contributing to Asyar! Whether you're fixing a bug, improving documentation, building an extension, or proposing a new feature, we're excited to have you in our community.

---

## Community & Questions

- **Discord**: Join our [Discord Server](https://discord.gg/vvYRXrs7Xa) for live discussions, brainstorming, and developer support.
- **GitHub Discussions**: Use [Discussions](https://github.com/Xoshbin/asyar/discussions) for Q&A, general inquiries, and feature proposals.
- **GitHub Issues**: Use [Issues](https://github.com/Xoshbin/asyar/issues) to report bugs and track roadmap items.

---

## Getting Started & Development Setup

### Prerequisites

- **Node.js**: >= 20
- **pnpm**: >= 10.26
- **Rust toolchain**: Latest stable (via `rustup`)
- **Platform dependencies**:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: Standard Tauri/WebKitGTK dependencies (`libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`)
  - **Windows**: Visual Studio C++ Build Tools & WebView2

### Initial Setup

Clone the repository and run the setup script:

```bash
git clone https://github.com/Xoshbin/asyar.git
cd asyar
node setup.mjs
```

`node setup.mjs` handles the full bootstrapping process:

1. Installs workspace dependencies with `pnpm install`
2. Generates required code artifacts and type definitions
3. Builds the `asyar-sdk` package
4. Clones sample/optional extensions
5. Runs `asyar doctor` to verify system requirements

---

## Repository Structure

Asyar is organized as a pnpm monorepo:

- **`asyar-launcher/`**: The core desktop launcher application.
  - `src/`: Svelte 5 frontend UI, services, and built-in features.
  - `src-tauri/`: Rust backend (window management, search indexing, native OS integration, usage DB).
- **`asyar-sdk/`**: The developer SDK and contracts used by extensions (`view`, `worker`, `contracts`, and `cli`).
- **`asyar-ext-builder/`**: The extension packaging and build toolchain.
- **`extensions/`**: Tier 2 sample and community extensions.
- **`docs/`**: Full developer documentation organized under the [Diátaxis framework](https://diataxis.fr/).

---

## Common Development Commands

All commands can be run from the root directory:

```bash
# Run the desktop launcher in development mode
pnpm dev

# Run unit tests across the launcher
pnpm --filter asyar test:run

# Run Rust unit tests
cd asyar-launcher/src-tauri && cargo test

# Verify design system token usage
pnpm check:design

# Format all files with Prettier
pnpm format
```

---

## Developer Documentation

Before diving deep into code, explore the developer documentation in [`docs/`](docs/):

- **[Tutorials](docs/tutorials/)**: Step-by-step guides to building extensions.
- **[How-To Guides](docs/how-to/)**: Focused instructions for specific developer tasks.
- **[Reference](docs/reference/)**: Manifest schemas, SDK APIs, CLI commands, design tokens, and icons.
- **[Explanation](docs/explanation/)**: Architecture deep-dives (two-tier extension model, IPC bridge, security isolation).

---

## Finding a Starter Task

If you want to contribute but aren't sure where to start:

1. **Build or Improve an Extension**:
   - Creating a new extension or adding features to existing extensions in `extensions/` is the fastest, safest way to contribute without modifying core launcher internals.
   - You can test extensions locally using `asyar dev` or sideload them directly into your development build.

2. **Documentation & Polish**:
   - Clarify developer guides or tutorials in `docs/`.
   - Improve error messages or help text.

3. **Check Open Issues & Discussions**:
   - Browse [open issues](https://github.com/Xoshbin/asyar/issues) and [discussions](https://github.com/Xoshbin/asyar/discussions).
   - If an issue seems interesting, leave a comment asking for context or confirmation before starting significant work.

---

## Guidelines for Pull Requests

1. **Branching**: Create a feature branch off `main` (e.g. `feat/my-feature` or `fix/issue-description`).
2. **Testing**:
   - Write automated unit tests for new logic or bug fixes.
   - Ensure all existing tests pass (`pnpm --filter asyar test:run` and `cargo test`).
3. **Code Style & Formatting**:
   - Run `pnpm format` before opening a pull request.
   - Run `pnpm check:design` if modifying launcher UI components to ensure all design tokens and rules are respected.
4. **Pull Request Description**:
   - Describe the problem being solved and how your changes address it.
   - Link related issue numbers (e.g., `Fixes #123`).
