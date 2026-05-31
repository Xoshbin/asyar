---
order: 1
---
## 11. The "Create Extension" Built-in Tool

The fastest and most reliable way to scaffold a new extension is the **Create Extension** feature built into Asyar itself. It is available as a command in the launcher.

### How to open it

Open Asyar → type **"Create Extension"** → press Enter.

### The three scaffolded types

| Type | Template produces | Best for |
|---|---|---|
| **View** | `main.ts` + `DefaultView.svelte` + view manifest | Rich UI panels, forms, browsers, editors |
| **Result** (Search + View) | `main.ts` + `index.ts` (with `search()`) + `DetailView.svelte` | Documentation search, contact lookup, file search |
| **Logic** | `main.ts` only (no Svelte component) | Background actions, clipboard tools, webhooks |

### What the scaffolder does

1. **Prompts you** for: name, ID, description, save location, extension type.
2. **Resolves the latest SDK version** from the npm registry (`npm view asyar-sdk version`). Falls back to `^3.1.0` if offline.
3. **Writes all project files** from templates, replacing `{{EXTENSION_NAME}}`, `{{EXTENSION_ID}}`, `{{EXTENSION_DESC}}`, and `{{SDK_VERSION}}` placeholders.
4. **Runs `pnpm install`** to install all dependencies.
5. **Runs `pnpm run build`** to produce the initial `dist/`.
6. **Calls `register_dev_extension`** — stores your project path in `dev_extensions.json` so Asyar resolves the `asyar-extension://` protocol to your local directory. **No `asyar link` needed**.
7. **Opens VS Code** (or falls back to your default file manager).

After generation, your extension is **immediately active** in Asyar. Open the launcher, type your command name, press Enter.

### Template file reference

Every scaffolded project includes these files:

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (type-specific template) |
| `package.json` | npm/pnpm project with build scripts |
| `vite.config.ts` | Vite build config with SDK alias for dev mode |
| `tsconfig.json` | TypeScript config |
| `index.html` | Vite entry point HTML |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `.env`, `*.zip` |
| `src/main.ts` | iframe bootstrap — creates `ExtensionContext`, signals readiness, mounts component |
| `src/index.ts` | Extension class (view and result types) |
| `src/DefaultView.svelte` | View component (view type) |
| `src/DetailView.svelte` | Detail view component (result type) |

### Build an extension with AI

The same built-in feature also offers an AI path that turns a plain-language
prompt into a working extension.

Open Asyar → type **"Build Extension with AI"** → describe what you want
(e.g. *"create an extension for Notion"*).

**Prerequisites**

- An **Anthropic API key** in **Settings → AI → Anthropic** (the feature uses your
  own key; it refuses to start without one).
- The bundled coding runtime ships with Asyar — no separate install.

**What happens**

1. **Feasibility gate.** Before writing anything, the agent checks the request
   against Asyar's capability list and tells you plainly if it's impossible
   (and suggests the nearest thing it *can* build) — so you never wait on a build
   that can't work.
2. **Async build.** For feasible requests it builds in the background. You can
   leave the view and keep working; it notifies you when it's done.
3. **Questions as notifications.** If the agent needs a decision mid-build (or an
   API key to verify a third-party integration), it pauses and sends a
   notification — click it to answer, and the build resumes.
4. **Verified done.** On success the extension is registered and activated
   automatically, the same as the manual scaffolder. It lands in
   `~/AsyarExtensions/<id>/`.

> **Safety note.** The build runs the `package.json` scripts the AI writes
> (`pnpm install`, `pnpm run build`) — i.e. it executes generated code on your
> machine, the same as building any project you cloned. The in-view notice says
> as much. Only build extensions you understand. Shell commands the agent runs are
> restricted to a build-command allowlist.

### Browse your extensions: "My Extensions"

Open Asyar → type **"My Extensions"** → browse everything in `~/AsyarExtensions/`.

- Type to filter by name, ID, or description.
- **Enter** opens the selected extension in your editor.
- **⌘K** (the action panel) offers **Open in editor** and **Publish to Asyar Store**.

### Publish to the Asyar Store

From the AI builder's done screen *or* from **My Extensions**, the action panel
(**⌘K**) has **Publish to Asyar Store**. It confirms first (publishing creates a
**public GitHub repo** under your account and submits for review), then opens a
terminal running [`asyar publish`](./publishing.md) in the extension's directory.
The CLI handles the rest — GitHub sign-in (in your browser, first time only),
release, and store submission. See **[Publishing an extension](./publishing.md)**
for the full flow and what gets created.

---
