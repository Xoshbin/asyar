# Asyar

**Local-First Cross platform open-source alternative to Raycast.**

Asyar is a fast, extensible, **local-first** command launcher for macOS, Windows, and Linux. No account. No cloud. No subscription. Just a blazing-fast launcher that stays entirely on your machine.

Built with [Tauri v2](https://tauri.app/) + Rust and [Svelte 5](https://svelte.dev/) — not Electron.

https://github.com/user-attachments/assets/fc3b0e5e-9af8-49c4-8da8-d87b44338a0e

---

## Asyar vs. The Alternatives

| | **Asyar** | Raycast | Alfred |
|---|:---:|:---:|:---:|
| Open Source | ✅ | ❌ | ❌ |
| Local-First (data never leaves device) | ✅ | ❌ | ✅ |
| No Account Required | ✅ | ❌ (Pro features) | ✅ |
| No Cloud Required | ✅ | ❌ | ✅ |
| Free Extensions | ✅ | Freemium | Paid Powerpack |
| Linux Support | ✅ | ❌ | ❌ |
| Native Rust Backend | ✅ | ❌ | ❌ |
| Reactive Svelte 5 UI | ✅ | ❌ | ❌ |
| Extension Sandboxing | ✅ | ❌ | ❌ |
| Root-Search Extension Actions | ✅ | ❌ | ❌ |
| Window Management | ✅ | ✅ | ❌ |
| Deep Link Integration | ✅ | ✅ | ✅ |
| Background Scheduling (native Rust daemon) | ✅ | ❌ | ❌ |
| Reactive Live Subtitles (real-time root list updates) | ✅ | ❌ | ❌ |
| **Silent AI Commands** (no-window in-place text replacement) | ✅ | ❌ | ❌ |

---

## Tiny Footprint. Native Performance.

Asyar is built with **Tauri + Rust** instead of Electron. That means:

- **Significantly less RAM** — no bundled Chromium, no V8 runtime sitting idle
- **Instant startup** — the Rust backend initializes in milliseconds
- **Real OS integration** — native APIs for app indexing, clipboard, global hotkeys, and accessibility
- **Secure by default** — extensions run in isolated iframes; a broken extension can't crash the launcher

> *Native performance, web flexibility — Rust does the heavy lifting, Svelte 5 keeps the UI snappy.*

---

## Features

- **Application Launcher** — Find and launch any installed application instantly
- **AI Agents with Tool Calling** — Build custom AI agents with persistent threads and tool calling, backed by your choice of provider (OpenAI, Anthropic, Google, Ollama, OpenRouter, or any OpenAI-compatible endpoint). **Asyar Assistant** is built in — press `Tab` from the empty launcher to summon it. Streaming responses, LaTeX math, syntax highlighting, and Mermaid diagrams included.
- **Silent AI Commands** — Mark any agent as silent, point it at your selection (or clipboard, or a one-shot argument), and have the response **replace the text in place** in whatever app you were typing in. No launcher window, no chat view, no confirm dialog. Perfect for "fix grammar", "translate this", "make it shorter", or any other one-shot transform you run dozens of times a day.
- **Built-in Tools for Agents** — Eight tools your agents can use out of the box: calculator, clipboard read/write, file read/write, shell execution, web fetch, and launcher search. Extensions can register their own tools too.
- **MCP (Model Context Protocol)** — Connect any MCP-compatible server. Auto-detects existing configs from Claude Desktop, Cursor, Cline, Continue, and Zed; bundled `bun` and `uv` let `npx`/`uvx`-based servers run without a local Node.js or Python install. First-call permission prompts gate write and exec tools per agent.
- **Scripts** — Run shell scripts from the launcher. Add metadata headers (`@asyar.title`, `@asyar.icon`, `@asyar.argument:N`) so your script gets a name, icon, and prompted arguments. Live progress surfaces as a run row.
- **Run Tracking** — Long-running work — agents and scripts — shows live status dots in the launcher. Failed runs stay until dismissed; succeeded agent threads stay until you close them, so you can pick a conversation back up at any time.
- **Calculator** — Instant math evaluation with currency conversion, directly in the search bar
- **Clipboard History** — Search and reuse anything you've copied, with rich markdown, syntax highlighting, and LaTeX rendering for text items
- **Snippets** — Text snippet expansion, including background text expansion without opening the launcher
- **Shortcuts** — Define and run custom keyboard-triggered commands
- **Portals** — Open URLs and web tools directly from the launcher
- **Window Management** — 17 built-in layout presets (halves, quarters, thirds, maximize, center) plus custom saved layouts; undo the last move with "Restore Previous"; works on macOS, Windows, and Linux
- **Context Modes** — Type prefixes (`ask ai`, a URL, etc.) to switch the launcher into a specialized mode; visual chips indicate the active context
- **Create Extension** — Scaffold a new extension from a template without leaving the launcher
- **Themes** — Customize the launcher's appearance with built-in themes or create your own
- **Backup & Restore** — Export and import your data locally; optional password encryption for sensitive fields
- **Privacy by Default** — Clipboard items the OS or source app marks private (NSPasteboard concealed/transient/auto-generated, Windows clipboard-history opt-out) are never stored; password managers (1Password, Bitwarden, KeePassXC, Dashlane, Enpass, LastPass, Apple Keychain Access) are denylisted by default. Known secret formats (AWS keys, GitHub/GitLab/Stripe/Slack/OpenAI/Anthropic tokens, JWTs, PEM private keys, Luhn-validated credit cards) are redacted in place across clipboard, snippets, and AI conversations — including before the AI provider sees them.
- **Extension Store** — Browse and install extensions from [asyar.org](https://asyar.org)
- **Root-Search Extension Actions** — Extensions declare ⌘K actions directly in `manifest.json` at two scopes: extension-level (any command selected) and command-level (only that command). Both scopes stack automatically.
- **Deep Link Integration** — Trigger any extension command from a browser, terminal, or script via `asyar://extensions/{extensionId}/{commandId}?param=value` URLs
- **Reactive Live Subtitles** — Extensions push real-time data into search result subtitles without re-running a search; used by the built-in calculator and available to any extension via `updateCommandMetadata()`
- **Background Scheduling** — Commands declare a `schedule` interval in `manifest.json` (1 min – 24 h) to run background tasks automatically, even when the launcher is closed
- **HUD Notifications** — Lightweight, auto-dismissing heads-up messages for instant feedback (e.g., layout name after a window move, "Copied" after a snippet paste)
- **Live Tray Menu** — Extensions can show real-time status in your system tray
- **Cross-Platform without Compromise** — First-class citizen on macOS, Windows, and Linux — not a port
- **Keyboard-First** — Global hotkey (`Cmd+K` / `Ctrl+K`) to summon from anywhere

---

## Privacy Scorecard

| | Asyar |
|---|:---:|
| Data stored locally only | ✅ |
| Works fully offline | ✅ |
| No telemetry by default | ✅ |
| No account or login required | ✅ |
| No subscription to unlock features | ✅ |
| Extensions run in sandboxed iframes | ✅ |
| Sensitive backup fields encrypted | ✅ |
| Honors OS "do not capture" clipboard flags | ✅ |
| Configurable password-manager denylist | ✅ |
| Auto-redacts known secret formats (API keys, JWTs, private keys) | ✅ |
| AI provider receives redacted user messages, not raw secrets | ✅ |
| Local encryption at rest with OS-keychain key | ✅ |
| Cloud sync uploads only what changed | ✅ |
| Optional end-to-end encrypted cloud sync (passphrase + Argon2id + AES-256-GCM) | ✅ |

---

## Privacy Defenses

Asyar's privacy work is layered — each layer protects a different boundary, and the layers compose.

### Layer 1 — Capture-time exclusion

When a clipboard event arrives, Asyar inspects the OS pasteboard's type identifiers and the source app's bundle id **before** writing anything to disk. Items match any of the following are dropped at the door:

- **macOS** — pasteboards carrying `org.nspasteboard.ConcealedType`, `TransientType`, `AutoGeneratedType`, or Apple's auto-generated promised type.
- **Windows** — pasteboards registered with `CanIncludeInClipboardHistory` or `ExcludeClipboardContentFromMonitorProcessing`.
- **All platforms** — a configurable source-app denylist. Defaults cover 1Password, Bitwarden, KeePassXC, Dashlane, Enpass, LastPass, and Apple Keychain Access. Users add their own apps in **Settings → Privacy → Clipboard Privacy**.

Items rejected at this layer never reach SQLite, so they cannot leak via local disk theft, the diagnostics channel, or cloud sync.

### Layer 2 — Pattern-based secret redaction

For everything that *does* get stored, Asyar runs a regex-based detector over clipboard items (text / HTML / RTF), snippet expansions, and AI conversation messages. Each match is replaced in place with `[redacted: <kind>]` — items still appear in history but the secret value is gone.

Bundled detector kinds (false-positive rate near zero on plain-English text):

| Category | Kinds |
|---|---|
| Cloud & infra | `aws_access_key`, `stripe_live_secret`, `stripe_restricted` |
| Source forges | `github_pat`, `github_oauth`, `github_user_to_server`, `github_server_to_server`, `github_refresh`, `gitlab_pat` |
| Chat & AI | `slack_token`, `openai_key`, `anthropic_key` |
| Cryptography | `pem_private_key`, `jwt` |
| Financial | `credit_card` (Luhn-validated) |

**AI conversations are redacted before the provider call** — the AI provider never sees raw secrets either, even if the user pastes a JWT and asks "what does this token mean?".

The user can disable redaction globally or per-category in **Settings → Privacy → Secret Redaction**. The detector is a pure Rust function with a 1 MB scan cap; classifier latency is sub-millisecond on a typical paste.

### Layer 3 — Local encryption at rest

Clipboard `content` / `preview`, snippet `expansion`, AI conversation message bodies, and encrypted extension preferences are stored as AES-256-GCM ciphertext on disk. The 32-byte master key lives in the OS keychain — Keychain Services on macOS, Credential Manager on Windows, freedesktop Secret Service on Linux. An offline disk image alone is no longer sufficient to read your data; the attacker also needs an unlocked session keychain.

On Linux without Secret Service (headless, minimal WM, DBus-less containers) Asyar falls back to a `0600` file-backed key and surfaces a warning in **Settings → Privacy → Encryption at Rest**, telling you to install gnome-keyring or KWallet for full protection. macOS / Windows treat keychain unavailability as fatal — the keychain is part of the OS install, so failure is exceptional and refusing to start is safer than silent degradation.

### Layer 4a — Minimal cloud sync

Cloud sync (when enabled) is built around a simple privacy promise: **the less data on the wire, the smaller the surface for any potential breach.** Asyar uploads only what you've actually changed since your last sync — never your whole history, never on a fixed schedule. An idle launcher moves zero bytes. Editing one snippet syncs one snippet. Concurrent edits on different devices coexist instead of overwriting each other.

### Layer 4b/4c — Optional end-to-end encrypted cloud sync

Opt-in passphrase-based E2EE on top of the per-item sync layer. Default OFF. Enable in **Settings → Account → Encrypted Sync**.

- Passphrase → Argon2id → 32-byte sync key → AES-256-GCM per item.
- Passphrase entered once at enrolment; derived key cached in the OS keychain — daily UX has zero friction.
- 24-word BIP-39 recovery phrase issued at enrolment. Passphrase loss without the recovery phrase means data loss; Asyar.org cannot reset it.

### Future layers (planned)

- **Layer 5** — Per-item "don't sync" toggles, AI conversation retention cap, snippet "private" tag.

See [`docs/explanation/clipboard-privacy.md`](docs/explanation/clipboard-privacy.md) for the full design.

---

## OS Support Matrix

| Feature | macOS | Windows | Linux (X11)* |
|---------|:-----:|:-------:|:------------:|
| Spotlight | ✅ | ✅ | ✅ |
| Applications | ✅ | ✅ | ✅ |
| Application Icons | ✅ | ✅ | ✅ |
| AI Agents | ✅ | ✅ | ✅ |
| Silent AI Commands | ✅ | ✅ | ✅ |
| MCP Servers | ✅ | ✅ | ✅ |
| Scripts | ✅ | ✅ | ✅ |
| Calculator | ✅ | ✅ | ✅ |
| Clipboard History | ✅ | ✅ | ✅ |
| Context Modes | ✅ | ✅ | ✅ |
| Create Extension | ✅ | ✅ | ✅ |
| Portals | ✅ | ✅ | ✅ |
| Shortcuts | ✅ | ✅ | ✅ |
| Snippets | ✅ | ✅ | ✅ |
| Store | ✅ | ✅ | ✅ |
| Installed Extensions | ✅ | ✅ | ✅ |
| Backup & Restore | ✅ | ✅ | ✅ |
| Window Management | ✅ | ✅ | ✅ |
| Deep Links | ✅ | ✅ | ✅ |
| Background Scheduling | ✅ | ✅ | ✅ |
| HUD Notifications | ✅ | ✅ | ✅ |

> * **Note on Linux Wayland:** Global input-heavy features like Snippets do **not** work on Wayland (e.g., default Ubuntu 22.04+, Fedora 25+, KDE Plasma 6).

### Detailed Platform Compatibility

*(Asyar is fully tested and verified on **macOS**, **Windows 11**, and **Debian**)*

- **macOS:** Fully supported and tested. Global features like Snippets require Accessibility permissions.
- **Windows:** Fully tested on Windows 11. Supported on Windows 10 out-of-the-box.
- **Linux (X11):** Fully tested on Debian. Supported on all other X11 sessions (Mint, MATE, Xfce, Ubuntu on Xorg).
- **Linux (Wayland):** ❌ Not supported for global hooks. *Workaround: Log out and select an "Xorg" or "X11" session at your login screen.*

---

## Tech Stack

| Layer | Technology | Why It Matters |
|-------|-----------|----------------|
| Backend | Rust (Tauri v2) | Native OS integration, memory safety, no Electron overhead |
| Frontend | Svelte 5 | Fine-grained reactivity, minimal bundle size, instant renders |
| Extensions | TypeScript + any web framework | Build with Svelte, React, Vue, or vanilla JS — sandboxed in iframes |
| Extension Store | [asyar.org](https://asyar.org) | Browse, publish, and install community extensions |

---

## How Extensions Work

Asyar's power comes from its extension system. Extensions add commands to the launcher, contribute live search results, and open rich UI panels.

- **Built-in extensions** run natively alongside the app for maximum speed
- **Installed extensions** run in secure sandboxes — they can't crash the app or access other extensions' data
- **Build your own** with the [Asyar SDK](asyar-sdk/) using any web framework (Svelte, React, Vue, or vanilla JS)

---

## Extension Security Model

Raycast gives every extension full Node.js access — filesystem, network, child processes — with no restrictions. Asyar takes a different approach: **extensions only get the permissions they declare, enforced at two layers.**

Every installed extension declares the permissions it needs in its `manifest.json`. At runtime, those declarations are enforced twice:

1. **Frontend gate** — the IPC router intercepts every extension call and checks it against the manifest before it ever reaches the backend
2. **Rust gate** — the permission registry enforces the same rules again at the Rust layer, so a compromised frontend can't bypass security

| Permission | What it grants |
|------------|---------------|
| `clipboard:read` / `clipboard:write` | Access the system clipboard |
| `fs:read` / `fs:write` | Read or write files |
| `network` | Make HTTP requests |
| `shell:execute` | Run shell commands |
| `shell:open-url` | Open URLs in the browser |
| `notifications:send` | Show system notifications |
| `store:read` / `store:write` | Persist extension data |
| `tools:register` | Register tools that AI agents can invoke |
| `runs:track` | Surface long-running work in the launcher's runs UI |

On top of permission gating, each installed extension runs in an **isolated iframe** with its own browsing context — no access to the host DOM, no access to other extensions' data, and a strict Content Security Policy that prevents loading external scripts. All communication flows through a typed `postMessage` bridge; malformed messages are rejected.

> *The result: users can install community extensions without trusting them with full system access.*

---

## AI Agents

Asyar agents are first-class command targets — type the agent's name, press `Enter`, and chat in a persistent thread. Each agent has its own provider, model, system prompt, and toolset.

- **Asyar Assistant (built in)** — A default agent appears the moment you configure any provider. Press `Tab` from the empty launcher to summon it, or type `ask ai`.
- **BYOK across 6 providers** — OpenAI, Anthropic, Google, Ollama, OpenRouter, or any OpenAI-compatible endpoint. API keys live in the OS keychain; no Asyar account or AI subscription needed.
- **Tool calling on every provider** — All six supported providers can invoke tools — the 8 built-in tools (calculator, clipboard, file I/O, shell, web fetch, launcher search), tools contributed by installed extensions, or tools served by any MCP server.
- **Persistent threads** — Conversations are saved locally in SQLite. Start a new thread or resume an existing one from the agent's `⌘K` menu; succeeded threads remain visible in the launcher until you dismiss them.
- **MCP integration** — Add Model Context Protocol servers from **Settings → MCP**, or auto-import existing configs from Claude Desktop, Cursor, Cline, Continue, or Zed. Bundled `bun` and `uv` sidecars run `npx`/`uvx`-based servers without system installs.
- **Streaming + cancellation** — Replies stream word-by-word; cancel mid-response.
- **Your key, your data** — requests go directly from your device to your provider; nothing routes through Asyar servers.

---

## Silent AI Commands

1. Open the launcher → **Manage Agents** → **New Agent**.
2. Name it (e.g. *Grammar Fix*), set a one-line system prompt (*"Reply ONLY with the corrected text — no preamble, no quotes"*).
3. Toggle **Run silently (no chat view)** on. Pick an **Input source** and an **Output action**.
4. Save, then bind a hotkey from the launcher root with ⌘K → *Set Shortcut*.

Now select text anywhere — TextEdit, your editor, a browser textarea, Mail — and press your hotkey. The selection is sent to the LLM and the response **replaces it in place**. The launcher never opens.

| Input source | Where the agent's input comes from |
|---|---|
| **Selected text in the active app** | The text you currently have highlighted (read via Accessibility) |
| **Clipboard** | Whatever you most recently copied |
| **Argument** | A one-shot text argument typed in the chip row |
| **None** | Empty input — the prompt alone drives the response |

| Output action | What happens to the LLM's response |
|---|---|
| **Replace the selection with the result** | Saves your clipboard, writes the result, pastes (replacing the selection), then restores your clipboard a moment later |
| **Copy to clipboard** | Quietly copies the result; nothing is pasted |
| **Paste at cursor** | Pastes at the cursor position without trying to replace anything |
| **Show a HUD with the last line** | Brief top-of-screen toast with the last line of the response |

The whole pipeline is structurally headless — silent agents never create a thread, never enter the Run Tracker's "Done" list, never fire a notification on success (failures still notify, with the error in the body). Tool-using silent agents are supported: the loop iterates until a final assistant message and only then triggers the output action.

See [`docs/reference/silent-agents.md`](docs/reference/silent-agents.md) for the full reference.

---

## Context Modes

Typing certain prefixes transforms the launcher into a specialized mode:

| Prefix | Mode |
|--------|------|
| `ask ai`, `ai`, `chat` | Asyar Assistant (AI Agent) |
| A URL or portal trigger | Portal / web view |

An active context is shown as a chip in the search bar. Press `Escape` to exit the current context and return to normal search.

---

## Snippets

Define reusable text snippets and expand them anywhere:

- **In-launcher** — search for a snippet and paste it into the focused app
- **Background expansion** — type a snippet keyword in any app and it expands automatically, without opening the launcher (requires Accessibility permissions on macOS)

---

## Window Management

Asyar includes a built-in window management extension that lets you snap and resize any window without leaving the keyboard.

- **17 layout presets** — left/right halves, top/bottom halves, all four corners, thirds (left, center, right), two-thirds, maximize, and center
- **Custom layouts** — save the current window position and size as a named preset, then recall it any time
- **Restore Previous** — one command undoes the last layout change so you can quickly toggle between two positions
- **Cross-platform** — uses native accessibility APIs on macOS, HWND positioning on Windows, and X11 window IDs on Linux

Invoke any layout preset by name from the launcher — no mouse required.

---

## Deep Links

Any extension command can be triggered from outside Asyar via the `asyar://` URL scheme:

```
asyar://extensions/{extensionId}/{commandId}?param=value
```

This lets you wire up browser bookmarklets, terminal aliases, Alfred/Raycast migration scripts, or any automation tool to drive Asyar commands directly. Arguments are passed as query parameters and forwarded to the command handler as-is.

Deep link inputs are validated (character allowlist, path-traversal prevention) before any command is executed.

---

## Reactive Live Subtitles

Extensions can push real-time data into a command's subtitle while it sits in search results — no re-search required.

```ts
commandService.updateCommandMetadata(commandId, { subtitle: '⏱ 18:32 remaining' });
```

The launcher reflects the update instantly and reactively. The built-in calculator uses this to show the evaluated formula as a subtitle. Extension authors can use it for live weather, countdowns, connection status, or any frequently-changing value.

---

## Background Scheduling

Commands can run at regular intervals without any user interaction by declaring a `schedule` in `manifest.json`:

```json
{
  "name": "refresh-rates",
  "trigger": "Refresh Currency Rates",
  "schedule": { "interval": 3600 }
}
```

The scheduler (backed by Tokio) fires the command every `interval` seconds (60 s – 86 400 s). It starts automatically when the extension is enabled and stops when it is disabled or removed — no manual lifecycle management needed.

---

## Backup & Restore

Asyar lets you export and import your data locally — no account required.

Go to **Settings → Backup** to:

- **Export** — choose which categories to include (snippets, clipboard history, extensions, etc.), optionally set a password to encrypt sensitive fields (like API keys), and save a `.zip` archive to disk.
- **Restore** — open a backup file, preview what's inside (item counts and conflicts per category), choose a conflict strategy (`replace`, `merge`, or `skip`) per category, then apply.

**How sensitive data is handled:** if a backup contains sensitive fields and no password is set, those fields are stripped from the export automatically. When a password is provided, the archive is encrypted and the password is required to restore it.

Cloud sync and account-based backup are intentionally out of scope — they will live in a future **Account** tab.

---

## Build an Extension

```bash
npm install -g asyar-sdk
```

The `asyar` CLI handles the full workflow — scaffolding, development, building, and publishing:

```bash
asyar dev        # development mode with hot reload
asyar build      # production build
asyar publish    # package and publish to the store
```

See the [developer documentation](docs/) for the full walkthrough — start with the [tutorials](docs/tutorials/).

---

## Contributing

We welcome contributions! To set up the full development environment:

```bash
git clone https://github.com/Xoshbin/asyar.git
cd asyar
node setup.mjs
```

`setup.mjs` installs workspace dependencies, builds the SDK, downloads the bundled MCP sidecar binaries, clones any optional Tier 2 sample extensions (like `sdk-playground`) into `extensions/`, and runs `asyar doctor` to verify the setup.

### MCP sidecar binaries

Asyar bundles `bun` and `uv` binaries (in `asyar-launcher/src-tauri/binaries/`) so users can run
npx/uvx-based MCP servers without a local Node.js or Python installation. These
binaries are not checked in to version control. `node setup.mjs` populates them automatically,
but if you need to refresh them manually:

```bash
node asyar-launcher/scripts/download-sidecars.mjs
```

This command is idempotent — safe to run multiple times. CI pipelines must run
it before the build step.

For architecture details, see the [explanation docs](docs/explanation/).
For release procedures (both launcher and SDK), see [`RELEASING.md`](RELEASING.md).

### Recommended IDE

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## License

Distributed under the AGPLv3 License. See [LICENSE](LICENSE) for more information. Both `asyar-launcher/` and `asyar-sdk/` are AGPL-3.0.
