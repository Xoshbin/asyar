# Screen OCR

> Extract and copy text from any region of your screen with on-device text recognition.

## What it does

Screen OCR lets you capture any area of your screen and instantly extract its text into your clipboard. Whether you are extracting code snippets from a video tutorial, text from an image, unselectable text in a desktop application, or error messages from a dialog box, Screen OCR reads the characters on-device and copies them formatted and ready to paste.

For safety, extracted text passes through Asyar's built-in **secret redaction** filter before being placed on the clipboard — preventing accidental exposure of API keys, tokens, and private credentials.

## How to use it

1. Open Asyar and search for **Capture Text from Screen** (or type `ocr` or `capture`).
2. Press `Enter`. The launcher dismisses and an interactive screen crosshair appears.
3. Click and drag to draw a box around the area containing the text you want to capture.
4. Release the mouse. Asyar processes the image with on-device OCR, applies secret redaction, and copies the recognized text directly to your clipboard.
5. A brief heads-up notification (HUD) confirms the capture with a preview of the recognized text and character count.

You can paste the captured text immediately into any app with `⌘V` (or `Ctrl+V` on Windows/Linux).

## Shortcuts & actions

| Action                     | How                                                 |
| -------------------------- | --------------------------------------------------- |
| Capture Text from Screen   | Search `capture text` or `ocr`, then press `Enter`  |
| Cancel interactive capture | Press `Esc` while the selection crosshair is active |

### Recommended global hotkey

Screen OCR is most powerful when bound to a global keyboard shortcut:

1. Open **Settings → Extensions** (`⌘,`).
2. Find **Screen OCR**, expand its commands, and click **Record Hotkey** next to **Capture Text from Screen**.
3. Press a combination such as `⌥⇧O` or a standalone function key (`F1`–`F24`), then click **Save**.

Now you can snip and copy text from any application without opening Asyar first.

## Platform support & privacy

- **On-device processing**: On macOS, text recognition runs locally via the Apple Vision framework. Your screen captures are never sent over the network or uploaded to cloud services.
- **Secret redaction**: If the captured screen area contains sensitive strings matching recognized secret patterns (such as AWS keys, GitHub tokens, or private keys), Asyar redacts them before writing to the clipboard, adhering to your privacy settings in **Settings → Privacy → Secret Redaction**.
- **Permissions**: Requires the `clipboard:write` permission and screen capture accessibility permissions on macOS when prompted.

## Tips

- **Unselectable text**: Use Screen OCR on web apps that disable text selection, remote desktop sessions, PDF documents with image-based text, and error modals.
- **Combine with Clipboard History**: Every captured text snippet is recorded in [Clipboard History](./clipboard-history.md), so you can retrieve previously extracted snippets at any time.
- **Combine with Asyar AI**: Once text is captured, paste it into [AI & Agents](./ai-and-agents.md) (press `Tab` in the search bar) to summarize, translate, or explain it.

## Related

- [The Basics](../the-basics.md)
- [Clipboard History](./clipboard-history.md)
- [Aliases & Shortcuts](./aliases-and-shortcuts.md)
- [Settings](../settings.md)
