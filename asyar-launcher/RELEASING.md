# Releasing the Launcher

The release flow for the launcher is documented in the **[root RELEASING.md](../RELEASING.md)** alongside the SDK flow.

Short version: from inside this directory, run

```bash
pnpm run release <patch|minor|major|beta|x.y.z>
```

See **[../RELEASING.md](../RELEASING.md)** for keyword semantics, the Windows MSI rule, what the release script automates, and post-CI manual steps.
