# Asyar

**Local-First Cross platform open-source alternative to Raycast.**

Asyar is a fast, extensible, **local-first** command launcher for macOS, Windows, and Linux. No account. No cloud. No subscription. Just a blazing-fast launcher that stays entirely on your machine.

Built with [Tauri v2](https://tauri.app/) + Rust and [Svelte 5](https://svelte.dev/) — not Electron.

https://github.com/user-attachments/assets/fc3b0e5e-9af8-49c4-8da8-d87b44338a0e

---

## Why Asyar?

Raycast is great. But when I moved to a new machine, I hit a wall: syncing my settings and installed extensions required a paid plan. And that plan was bundled with an AI subscription — for models I already pay for elsewhere.

**I didn't need a new AI. I needed my snippets, my extensions, and my shortcuts to follow me between devices.**

That one missing feature — free, local backup and restore — is what started this project. Asyar gives you full control over your data: export everything to a local file, carry it to any machine, and restore it instantly. No account. No subscription. No cloud you didn't ask for.

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
| Built on Electron | ❌ | ✅ | ❌ |
| Native Rust Backend | ✅ | ❌ | ❌ |
| Reactive Svelte 5 UI | ✅ | ❌ | ❌ |
| Extension Sandboxing | ✅ | ❌ | ❌ |
| Root-Search Extension Actions | ✅ | ❌ | ❌ |
| Window Management | ✅ | ✅ | ❌ |
| Deep Link Integration | ✅ | ✅ | ✅ |
| Background Scheduling | ✅ | ❌ | ❌ |
| Reactive Live Subtitles | ✅ | ❌ | ❌ |

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
- **AI Chat** — Built-in AI assistant with streaming responses, conversation history, and configurable provider/model settings
- **Calculator** — Instant math evaluation with currency conversion, directly in the search bar
- **Clipboard History** — Search and reuse anything you've copied
- **Snippets** — Text snippet expansion, including background text expansion without opening the launcher
- **Shortcuts** — Define and run custom keyboard-triggered commands
- **Portals** — Open URLs and web tools directly from the launcher
- **Window Management** — 17 built-in layout presets (halves, quarters, thirds, maximize, center) plus custom saved layouts; undo the last move with "Restore Previous"; works on macOS, Windows, and Linux
- **Context Modes** — Type prefixes (`ask ai`, a URL, etc.) to switch the launcher into a specialized mode; visual chips indicate the active context
- **Create Extension** — Scaffold a new extension from a template without leaving the launcher
- **Themes** — Customize the launcher's appearance with built-in themes or create your own
- **Backup & Restore** — Export and import your data locally; optional password encryption for sensitive fields
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
| Source code auditable | ✅ (AGPLv3) |
| Extensions run in sandboxed iframes | ✅ |
| Sensitive backup fields encrypted | ✅ |

---

## OS Support Matrix

| Feature | macOS | Windows | Linux (X11)* |
|---------|:-----:|:-------:|:------------:|
| Spotlight | ✅ | ✅ | ✅ |
| Applications | ✅ | ✅ | ✅ |
| Application Icons | ✅ | ✅ | ✅ |
| AI Chat | ✅ | ✅ | ✅ |
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
- **Build your own** with the [Asyar SDK](https://github.com/Xoshbin/asyar-sdk) using any web framework (Svelte, React, Vue, or vanilla JS)

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

On top of permission gating, each installed extension runs in an **isolated iframe** with its own browsing context — no access to the host DOM, no access to other extensions' data, and a strict Content Security Policy that prevents loading external scripts. All communication flows through a typed `postMessage` bridge; malformed messages are rejected.

> *The result: users can install community extensions without trusting them with full system access.*

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

See the [Extension Development Guide](docs/extension-development.md) for the full walkthrough.

---

## AI Chat

Asyar includes a built-in AI assistant accessible directly from the launcher. Type `ask ai`, `ai`, or `chat` to enter AI mode, or trigger it from any search result.

- **BYOK (Bring Your Own Key)** — connect your existing API key from OpenAI, Anthropic, or any compatible provider; no Asyar account or AI subscription needed
- **Streaming responses** — replies appear word-by-word as they're generated
- **Conversation history** — browse and resume past conversations
- **Configurable provider & model** — set your preferred AI provider and model in AI Chat settings
- **Your key, your data** — requests go directly from your device to your provider; nothing routes through Asyar servers

---

## Context Modes

Typing certain prefixes transforms the launcher into a specialized mode:

| Prefix | Mode |
|--------|------|
| `ask ai`, `ai`, `chat` | AI Chat |
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

## Command Metadata

Commands expose rich metadata in `manifest.json` beyond a name and trigger:

| Field | Purpose |
|-------|---------|
| `icon` | Display icon in search results |
| `description` | Full description shown in the detail panel |
| `trigger` | Keyword(s) that surface the command in search |
| `resultType` | `"no-view"` (runs and closes) or `"view"` (opens a panel) |
| `schedule` | Background execution interval (see above) |
| `preferences` | Command-level required/optional settings (populated via Settings UI) |
| `actions` | ⌘K actions scoped to this specific command |

All fields are validated at install time by the Rust discovery layer; missing required fields are rejected with a descriptive error.

---

## Backup & Restore

Asyar lets you export and import your data locally — no account required.

Go to **Settings → Backup** to:

- **Export** — choose which categories to include (snippets, clipboard history, extensions, etc.), optionally set a password to encrypt sensitive fields (like API keys), and save a `.zip` archive to disk.
- **Restore** — open a backup file, preview what's inside (item counts and conflicts per category), choose a conflict strategy (`replace`, `merge`, or `skip`) per category, then apply.

**How sensitive data is handled:** if a backup contains sensitive fields and no password is set, those fields are stripped from the export automatically. When a password is provided, the archive is encrypted and the password is required to restore it.

Cloud sync and account-based backup are intentionally out of scope — they will live in a future **Account** tab.

---

## Contributing

We welcome contributions! To set up the full development environment:

```bash
git clone https://github.com/Xoshbin/asyar.git
cd asyar
node setup.mjs
```

This clones all repositories, links the SDK, installs dependencies, and verifies the setup in one command. See the [asyar](https://github.com/Xoshbin/asyar) repo for the full development guide.

For architecture details, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
For release guidelines, see [docs/RELEASING.md](docs/RELEASING.md).

### Recommended IDE

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

---

## License

Distributed under the AGPLv3 License. See [LICENSE](LICENSE.md) for more information.
