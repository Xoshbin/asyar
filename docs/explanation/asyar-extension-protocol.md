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

**Security:** The iframe runs with this sandbox attribute:
```
allow-scripts allow-same-origin allow-forms allow-popups
```

And this Content Security Policy:
```
default-src asyar-extension: 'self';
script-src  asyar-extension: 'unsafe-inline' 'unsafe-eval';
style-src   asyar-extension: 'unsafe-inline';
font-src    asyar-extension:;
img-src     asyar-extension: data:;
```

External URLs in `<script src="">` tags are blocked. All networking goes through `NetworkService`.
