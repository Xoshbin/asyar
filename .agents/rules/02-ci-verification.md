# Mandatory Local CI Verification Matrix

Before concluding any implementation, bug fix, or refactor, **ALWAYS** run the full local CI verification matrix using the unified runner:

```bash
pnpm check:ci
```

### Steps executed by `pnpm check:ci`:

1. **Workspace Prettier Check**: `pnpm format:check`
2. **Design System Compliance**: `pnpm check:design`
3. **Full Frontend & Workspace Tests**: `pnpm -r --if-present test:run`
4. **Rust Formatting**: `cargo fmt --check` (in `asyar-launcher/src-tauri`)
5. **Rust Clippy**: `cargo clippy --all-targets -- -D warnings` (in `asyar-launcher/src-tauri`)
6. **Rust Test Suite**: `cargo test` (in `asyar-launcher/src-tauri`)

_(If TypeScript/Rust bindings were touched, also verify: `cargo test export_bindings -- --ignored` and check `git diff --exit-code -- asyar-launcher/src/bindings.ts`)_
