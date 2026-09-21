# Migrating from Raycast to Asyar

> A complete step-by-step guide to switching from Raycast to Asyar — how to bring over your data in seconds, how features map, and why Asyar is built differently.

If you are moving over from Raycast, you don't have to start over or re-type your setup by hand. I built an instant **Raycast Importer** directly into Asyar that extracts your snippets, quicklinks, and app shortcuts from a `.rayconfig` file in seconds.

---

## Why Switch?

Thousands of developers are switching to Asyar for a simpler, faster, and more private experience:

- **100% Offline & Local-First:** No mandatory account, no cloud login, and no background telemetry. Your data stays on your machine.
- **Free Bring Your Own Key (BYOK) AI:** Connect your own API keys for Claude, OpenAI, Google Gemini, Ollama, OpenRouter, or any OpenAI-compatible provider. No $8–$10/month Pro paywalls, no artificial credit caps, and full autonomous tool calling out of the box.
- **Instant Native Performance:** Built with **Tauri v2 + Rust** and a fine-grained **Svelte 5** frontend. Summons in 12–15 ms without the memory overhead of bundled Chromium or sluggish hybrid webviews.
- **Double-Gated Security:** Raycast runs extensions with unsandboxed Node.js child processes. Asyar runs extensions in isolated iframes guarded by two independent security gates: a frontend IPC filter and a Rust kernel permission verifier.
- **Encrypted at Rest:** Your snippets, clipboard history, and credentials are encrypted with AES-256-GCM using keys stored directly in your OS Keychain (macOS Keychain Services, Windows Credential Manager, or Linux Secret Service).

---

## Step 1: Export Your Data from Raycast

1. Open Raycast (`⌥Space` or your configured hotkey).
2. Type **Export Settings & Data** and press `Enter`.
3. Choose a destination folder. Raycast will save a `.rayconfig` archive containing your snippets, quicklinks, hotkeys, and aliases.
4. _(Optional)_ If you specify an export password in Raycast, make sure to keep it handy — Asyar's importer supports password-protected archives.

> [!TIP]
> Asyar also supports individual JSON exports created via Raycast's **Export Snippets** or **Export Quicklinks** commands.

---

## Step 2: Import into Asyar

You can trigger the import through any of these entry points:

1. **On First Launch (Welcome Tour):** If you are opening Asyar for the first time, click **Import from Raycast…** directly on the Welcome screen.
2. **From Command Search:** Summon Asyar (`⌘K` or `Ctrl+K`), type `Import from Raycast`, and press `Enter`.
3. **From Settings:** Open **Settings → Backup** and click **Import from Raycast…**.

### In the Import Screen:

1. Click **Choose export file…** and select your `.rayconfig` or `.json` file.
2. If your export is encrypted, enter your password and click **Unlock**.
3. Review the preview screen. Asyar scans the archive and categorizes everything found:
   - **Snippets:** Keywords, snippets text, and dynamic variables.
   - **Portals (Quicklinks):** Saved URLs and search queries.
   - **Shortcuts:** Global keyboard shortcuts mapped to installed applications.
   - **Aliases:** Custom letter/digit abbreviations for commands and apps.
4. Toggle any category you wish to include or exclude, then click **Import**.
5. When complete, Asyar displays a clear summary of how many items were added and how many duplicate items were skipped.

> [!NOTE]
> Importing is completely non-destructive. It reads your export file without touching your Raycast installation, and re-running an import will never create duplicate entries in Asyar.

---

## Feature-by-Feature Mapping

Here is how Raycast commands and concepts translate to Asyar:

| Raycast Feature         | Asyar Equivalent                            | Why It's Better in Asyar                                                                                                                                      |
| :---------------------- | :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Snippets**            | [Snippets](./snippets.md)                   | Encrypted at rest with AES-256-GCM in your OS Keychain. Automatic regex secret redaction prevents accidental credential leaks.                                |
| **Quicklinks**          | [Portals](./portals.md)                     | Support dynamic `{query}` and `{Clipboard Text}` arguments with zero webview overhead.                                                                        |
| **Raycast AI (Pro)**    | [AI & Agents](./ai-and-agents.md)           | 100% free BYOK across 6 providers (Claude, OpenAI, Gemini, Ollama, OpenRouter). Full autonomous tool calling with MCP support and zero monthly subscriptions. |
| **AI Text Replacement** | [Silent AI Commands](./ai-and-agents.md)    | Run prompts silently against selected text or clipboard; responses replace text in-place across any app without opening a launcher window.                    |
| **Switch Windows**      | Switch Windows                              | Fast fuzzy search across all active application windows with instant focus switching and no telemetry.                                                        |
| **Screen OCR**          | Screen OCR                                  | Native offline text recognition powered by Apple Vision on macOS. Copies extracted text straight to your clipboard with automatic secret redaction.           |
| **Window Management**   | [Window Management](./window-management.md) | 17 built-in layout presets, multi-display cycling, custom layout saving, and instant keyboard undo ("Restore Previous").                                      |
| **Scripts**             | [Scripts](./scripts.md)                     | Watched folder execution with rich `@asyar.*` metadata headers and live progress tracking dots.                                                               |
| **Clipboard History**   | [Clipboard History](./clipboard-history.md) | Local encrypted database, configurable password manager denylist, and automatic credit card/API key redaction before storage.                                 |
| **File Search**         | [File Search](./file-search.md)             | Bounded per-keystroke cost with a Rust arena index; Quick Look-style previews without loading heavy file payloads into memory.                                |
| **Extensions Store**    | [Extensions](./extensions.md)               | Double-gated security model. Extensions run in sandboxed iframes with explicit permissions enforced at both the IPC router and Rust kernel levels.            |
| **System Commands**     | System Commands                             | Instant native controls for Sleep, Lock Screen, Restart, Shutdown, Empty Trash, and Volume.                                                                   |

---

## What Carries Over (and What Doesn't)

### What Carries Over Automatically:

- **Snippets:** Text expansions and keywords. Raycast variable tokens like `{argument}` and `{Query}` automatically convert to Asyar's `{query}`; `{clipboard}` becomes `{Clipboard Text}`.
- **Quicklinks:** Converted to Asyar **Portals**. Custom URLs with search terms work right away.
- **Application Hotkeys & Aliases:** Any hotkey or short alias assigned to an application that is installed and indexed on your machine will be imported.

### What Needs Manual Setup:

- **AI Configuration:** Because Raycast manages API access centrally, you need to add your own API key (or point to local Ollama) in **Settings → AI Providers**. Once configured, you have unlimited AI with tool calling without paying a subscription.
- **Third-Party Extensions:** Raycast extensions execute raw Node.js code with full disk and process privileges. Asyar uses a strictly sandboxed, double-gated iframe architecture. You can browse community extensions on [asyar.org](https://asyar.org) or scaffold a replacement in seconds using **Build Extension with AI**.

---

## Frequently Asked Questions

### Do I need to create an Asyar account?

No. Asyar never requires an account, email, or login. Everything works completely offline from day one.

### Is cloud sync required?

No. Asyar is local-first. Cloud sync is entirely optional, disabled by default, and features client-side end-to-end encryption (Argon2id + AES-256-GCM) when enabled.

### Will my Raycast installation be affected?

Not at all. The importer only reads your exported `.rayconfig` or `.json` file. Your Raycast app and settings remain completely unchanged.

### What happens if I import twice?

Asyar uses intelligent duplicate detection (comparing keywords and text for snippets, and URLs for portals). If an item already exists, it is safely skipped rather than duplicated.

---

## Related Documentation

- [Import from Raycast Reference](./raycast-import.md)
- [Snippets Guide](./snippets.md)
- [Portals Guide](./portals.md)
- [AI & Agents Guide](./ai-and-agents.md)
- [Window Management Guide](./window-management.md)
