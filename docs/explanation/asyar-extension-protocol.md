---
order: 4
---

### The `asyar-extension://` protocol

When Asyar renders an extension iframe, it loads a URL like:

```
asyar-extension://com.yourname.hello-world/index.html?view=DefaultView
```

The Rust URI scheme handler (`uri_schemes.rs`) resolves this URL to a file with the following priority order:

1. **Dev extensions** — paths registered in `dev_extensions.json` (via `asyar link` or Create Extension). Enables hot-reload during development.
2. **Debug fallback** (debug builds only) — `src/built-in-features/{id}/dist/`.
3. **Built-in resources** — files bundled into the app binary.
4. **Installed extensions** — `$APP_DATA/extensions/{extensionId}/dist/`.

The protocol handler strips query parameters and URL fragments before filesystem lookup. It also has path-traversal protection (`..` segments are rejected).

Every response is sent with `Cache-Control: no-store`, like every other custom scheme. The files come from local disk, so caching them in the webview would only fill its disk cache.

**Security:** The iframe runs with this sandbox attribute:

```
allow-scripts allow-same-origin allow-forms allow-popups
```

And this Content Security Policy (release builds; debug builds additionally allow `'unsafe-eval'` in `script-src` for Svelte hot reload):

```
default-src asyar-extension: 'self';
script-src  asyar-extension: 'self' 'unsafe-inline';
style-src   asyar-extension: 'self' 'unsafe-inline';
font-src    asyar-extension: 'self' data:;
img-src     asyar-extension: 'self' asyar-icon: http://asyar-icon.localhost data:;
```

External URLs in `<script src="">` tags are blocked, and `img-src` has no `https:`, so a view cannot load a remote image directly — including an `<img>` inside Markdown or HTML you render. All networking goes through `NetworkService`; fetch the bytes and render them yourself (for example as a `data:` URL).

### Host Window Asset Resolution

The `asyar-extension://` protocol is also used by the host application (Settings and launcher search results) to load extension-bundled icon images (e.g. `asyar-extension://<extensionId>/icon.png`). The host window's Content Security Policy allows `asyar-extension:` in `img-src`, and the Rust protocol handler validates that the file is located within an approved extension directory before serving it.

Icon URLs from the icon resolver end in `?icon` (e.g. `asyar-extension://<extensionId>/icon.png?icon`). When an extension is installed or updated, Rust writes a 128px copy of each bundled PNG, JPEG, WebP or BMP icon larger than 128px. The copy is a hidden file next to the original (`.icon.png.128.png`), so uninstalling the extension removes it too. For an `?icon` request the handler serves that copy when it exists, and the original otherwise (SVG, GIF, small images, dev extensions, older installs). Requests without `?icon`, such as an extension view loading its own images, always get the original file.

Remote (`https://`) icons returned by search results and registered actions take a separate path. The host fetches the bytes through the scoped network stack, caches a 128px copy under `icon_cache/`, and hands the row an `asyar-icon://` URL; the webview never loads the remote URL directly. The extension must declare the `network` permission. See [Remote icons](../reference/design-system/icons.md#remote-icons).
