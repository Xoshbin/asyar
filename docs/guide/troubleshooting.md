# Troubleshooting

> Fixes for the most common problems.

## The hotkey doesn't open Asyar

If pressing your global hotkey does nothing:

1. **Check that Asyar is running.** Look for the Asyar icon in the menu bar. If it is not there, open Asyar from your Applications folder.

2. **Verify the hotkey is set.** Open **Settings → Shortcuts** (or **Settings → General → Hotkey**). The recorder should show your current combination. If it is blank, click inside and press your keys again, then save.

3. **Check for conflicts.** Another app may have claimed the same key combination. Open the shortcut recorder — if a conflict warning appears, choose a different combination that is not already in use.

4. **Check macOS Accessibility permission (macOS only).** Although Accessibility is mainly needed for text expansion, Asyar also needs it for reliable global hotkey registration on some macOS versions. Go to **System Settings → Privacy & Security → Accessibility**, find Asyar in the list, and make sure the toggle is on. Relaunch Asyar after granting access.

5. **Restart Asyar.** Search for "Quit Asyar" inside the launcher (if you can open it another way), or quit via the menu bar icon and reopen Asyar.

6. **Restart your computer.** Occasionally a fresh login is needed after granting system permissions for the first time.

## Asyar can't see my apps / accessibility

**Apps are missing from search:**

- Asyar scans `/Applications` and `~/Applications` by default. If your apps live somewhere else, go to **Settings → Applications** and click **Add Directory** to add the folder.
- Check that the app's toggle is on in the app list. If you previously disabled an app, its toggle is off.
- Wait a moment after installing a new app — Asyar watches the scan directories and picks up changes automatically, but it can take a few seconds.

**Accessibility permission not granted (macOS only):**

> **Windows and Linux users:** Accessibility permission is a macOS-only requirement. If you are on Windows or Linux and text expansion is not working, skip this section and check that **Settings → Advanced → Text Expansion** is enabled.

On macOS, Asyar needs Accessibility access to paste text snippets and capture selected text. Without it, text expansion and selection-aware AI commands will not work.

1. Open **System Settings → Privacy & Security → Accessibility**.
2. Find Asyar in the list. If it is not there, drag the Asyar app from your Applications folder into the list.
3. Enable the toggle next to Asyar.
4. If Asyar was already in the list but toggled off, toggle it off and back on, then relaunch Asyar.

You can also reach this screen directly from **Settings → General → Re-run onboarding**, which guides you through the accessibility step again.

## Search feels slow

Asyar's search is designed to be instant. If it feels slow:

- **First launch is slower.** On the very first launch Asyar indexes your applications and files. This runs in the background and takes only a few seconds. Subsequent searches are fast.

- **Too many scan directories.** If you added a very large directory (for example, your entire home folder) in **Settings → Applications**, Asyar may be scanning many files. Remove overly broad directories and add only the specific folders you need.

- **Restart Asyar.** Quit using the "Quit Asyar" command and reopen from Applications.

- **Restart your computer.** A full restart can resolve issues where background indexing stalled.

## AI isn't responding

If the AI chip is missing or AI queries return no response:

1. **Check that a provider is configured.** Open **Settings → AI**. If the providers list is empty, click **+ Add provider**, choose a provider (for example, Anthropic or OpenAI), and enter your API key.

2. **Check your API key.** An incorrect or expired API key causes silent failures. In the provider row, expand it and re-enter the key, then use the Test connection option if available.

3. **Check your network.** AI responses require an internet connection to the provider's API. Make sure your computer is online and not behind a firewall that blocks the provider's domain.

4. **Check the default provider.** In **Settings → AI**, confirm that the star (★) is set next to the provider you want to use. The starred provider powers the `Tab` AI chip.

5. **Check the model selection.** If you recently changed your model and the new model is unavailable on your plan, responses may fail silently. Click the provider row to expand it and pick a model you have access to.

## Browser bookmarks/history aren't showing

Asyar can search your browser's open tabs, bookmarks, and history, but it requires the Asyar companion extension to be installed in your browser and paired.

1. **Install the companion extension.** Download the Asyar companion for your browser (Chromium-based browsers are currently supported). Install it from your browser's extension page.

2. **Pair the browser.** After installation, the companion sends a pairing request to Asyar. Open **Settings → Browsers** — pending pairing requests appear there. Click **Allow** to approve the connection.

3. **Check the connection status.** Once paired, the browser appears in the paired list with a connection indicator. If it shows as disconnected, try restarting the browser with the companion extension active.

4. **Check that browser search is enabled.** In **Settings → Advanced**, confirm that Extension Search is turned on. Without it, browser results are not shown in the main search.

5. **Re-pair if needed.** If the companion and Asyar lose their connection after an update, revoke the old pairing in **Settings → Browsers → (remove)** and pair again.

## Related

- [Getting Started](./getting-started.md)
- [Settings](./settings.md)
- [FAQ](./faq.md)
