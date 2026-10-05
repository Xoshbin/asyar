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

# Run i18n static analysis & translation enforcement tests
pnpm --dir asyar-launcher test:run src/services/i18n/noHardcodedStrings.test.ts

# Run Rust unit tests
cd asyar-launcher/src-tauri && cargo test

# Verify design system token usage
pnpm check:design

# Format all files with Prettier
pnpm format

# Run the complete local CI verification matrix
pnpm check:ci
```

---

## Internationalization (i18n) & Translations

Asyar enforces a strict **Zero-Hardcoded-Strings** policy across the entire launcher frontend UI.

1. **User-Facing Strings**:
   - Never write raw text literals in Svelte templates (`<p>`, `<span>`, `<button>`, etc.), component props or attributes (`label`, `title`, `description`, `placeholder`, `hint`, `subtitle`, `message`, `aria-label`, `alt`), or in `.ts` code that produces user-visible text (action labels, dialogs, toasts, notifications).
   - Always import and call `t('namespace.key')` from `src/services/i18n`. Use `{name}`-style placeholders instead of template literals.
   - In Svelte 5 runes: For arrays containing translated strings, use `$derived([...])` to maintain reactivity when the active locale changes. For module-level constants, expose translated text as getters (a constant is otherwise evaluated once, before the system locale resolves).
   - Don't translate strings the code matches against, internal ids, or seed data stored in the user's database.
2. **Translation Catalogs**:
   - Base English translations live in [`asyar-launcher/src/locales/en.json`](asyar-launcher/src/locales/en.json).
   - When adding new keys, append them under the appropriate namespace (`search`, `actions`, `settings`, `features.<feature>`, `common`, or `components`).
   - Never delete or reorder existing keys in `en.json`.
3. **AST Static Analysis Enforcement**:
   - Svelte files are statically analyzed by an AST test suite ([`noHardcodedStrings.test.ts`](asyar-launcher/src/services/i18n/noHardcodedStrings.test.ts)), and `catalogs.test.ts` requires every locale to have exactly the keys and placeholders of `en.json`.
   - An invalid `t()` key, a missing or extra catalog key, or a hardcoded literal in a covered position fails local CI and pull request checks.
   - The suite does not scan `.ts` files, every attribute, or plain text in non-interactive elements, so review your diff for literals there yourself. See [Static AST Translation Enforcement](docs/explanation/locale-and-internationalization.md#8-static-ast-translation-enforcement).
4. **Contributing New Language Translations (Step-by-Step)**:
   - **Step 1 (Create file)**: Copy [`asyar-launcher/src/locales/en.json`](asyar-launcher/src/locales/en.json) to `asyar-launcher/src/locales/<locale>.json` using your language's ISO / BCP-47 code (e.g. `ckb.json` for Central Kurdish, `de.json` for German, `fr.json` for French, `ar.json` for Arabic, `es.json` for Spanish, `ja.json` for Japanese).
   - **Step 2 (Translate)**: Translate the string values into your target language. Keep the JSON object keys and hierarchy identical to `en.json`.
   - **Step 3 (Verify)**: Run the catalog verification test to ensure all keys and structures match:
     ```bash
     pnpm --dir asyar-launcher test:run src/services/i18n/
     ```
   - **Step 4 (Native strings)**: The tray menu and a few window titles are rendered by Rust, not the frontend. Add your language to [`asyar-launcher/src-tauri/src/locale/native.rs`](asyar-launcher/src-tauri/src/locale/native.rs) (the `match` is exhaustive, so the compiler lists what is missing) and run `cargo test --lib locale` from `asyar-launcher/src-tauri`.
   - For complete documentation on candidate fallbacks, manifest localization, and UI reactivity, see **[How to Add and Maintain Translations](docs/how-to/add-translations.md)**.

---

## Developer Documentation

Before diving deep into code, explore the developer documentation in [`docs/`](docs/):

- **[Tutorials](docs/tutorials/)**: Step-by-step guides to building extensions.
- **[How-To Guides](docs/how-to/)**: Focused instructions for specific developer tasks (e.g. [Adding Translations](docs/how-to/add-translations.md), publishing, debugging).
- **[Reference](docs/reference/)**: Manifest schemas, SDK APIs, CLI commands, design tokens, and icons.
- **[Explanation](docs/explanation/)**: Architecture deep-dives (two-tier extension model, IPC bridge, locale subsystem, and security isolation).

---

## Finding a Starter Task

If you want to contribute but aren't sure where to start:

1. **Translate Asyar into Your Language**:
   - Help make Asyar accessible worldwide by contributing locale catalogs for your native language in `asyar-launcher/src/locales/`.
2. **Build or Improve an Extension**:
   - Creating a new extension or adding features to existing extensions in `extensions/` is the fastest, safest way to contribute without modifying core launcher internals.
   - You can test extensions locally using `asyar dev` or sideload them directly into your development build.
3. **Documentation & Polish**:
   - Clarify developer guides or tutorials in `docs/`.
   - Improve error messages or help text.
4. **Check Open Issues & Discussions**:
   - Browse [open issues](https://github.com/Xoshbin/asyar/issues) and [discussions](https://github.com/Xoshbin/asyar/discussions).
   - If an issue seems interesting, leave a comment asking for context or confirmation before starting significant work.

---

## Guidelines for Pull Requests

1. **Branching**: Create a feature branch off `main` (e.g. `feat/my-feature` or `fix/issue-description`).
2. **Testing & Verification**:
   - Write automated unit tests for new logic or bug fixes.
   - Run the full local CI verification matrix: `pnpm check:ci` (ensures Prettier formatting, design token compliance, frontend tests, i18n enforcement, cargo fmt, clippy, and Rust tests all pass).
3. **Code Style & Formatting**:
   - Run `pnpm format` before opening a pull request.
   - Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`) exclusively. Svelte 4 syntax (`export let`, `$:`) is not accepted.
4. **Pull Request Description**:
   - Describe the problem being solved and how your changes address it.
   - Link related issue numbers (e.g., `Fixes #123`).
