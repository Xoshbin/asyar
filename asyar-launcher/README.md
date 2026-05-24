# asyar-launcher

This is the desktop application package inside the [Asyar monorepo](../README.md).

For features, install instructions, screenshots, and the full project overview, see the **[root README](../README.md)**. For architecture and developer documentation, see **[../docs/](../docs/)**.

## Local commands (run from inside this directory)

| Command | What it does |
|---------|-------------|
| `pnpm tauri dev` | Start the launcher in development mode (SDK must already be built) |
| `pnpm tauri build` | Production build |
| `pnpm run check` | Run svelte-check on the launcher |
| `pnpm run test` | Run launcher vitest suite |

Most workflows are easier from the **monorepo root** using the orchestration scripts:

```bash
# from monorepo root
pnpm dev          # builds SDK once, then runs Tauri dev with SDK watch
pnpm build        # full release build (cleans + builds SDK + Tauri build)
pnpm check        # asyar doctor + svelte-check
```

## Release process

See **[RELEASING.md](RELEASING.md)** for the launcher's tag-based release flow.

## License

AGPL-3.0 — see the [root LICENSE](../LICENSE).
