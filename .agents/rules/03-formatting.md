# Code Formatting & Linters

- **Agent Formatting Requirement**:
  - Editor format-on-save does not automatically run on files created or edited by agents.
  - Before concluding a task, ensure all touched files are formatted:
    - **JS / TS / Svelte / JSON / Markdown**: `pnpm exec prettier --write <file>` or `pnpm format`
    - **Rust**: `rustfmt <file>` or `cd asyar-launcher/src-tauri && cargo fmt`
