### Type 3: Theme Extension (`theme`)

**Use when:** You want to restyle the Asyar launcher UI — colors, backgrounds, accents, fonts — without writing any JavaScript. Theme extensions are purely declarative: a `manifest.json` that identifies the package and a `theme.json` that maps CSS variable names to new values.

**How it works:**
1. User installs the `.asyar` package (via Settings → Extensions → **Install from File...**).
2. The theme appears in Settings → Appearance → **Custom Themes**.
3. Selecting it applies all CSS variable overrides immediately — no restart required.
4. Selecting **Default** removes all overrides and reverts to built-in tokens.

**Key differences from view/result types:**
- `commands` must be an empty array (or omitted). Themes register no commands and appear in no search results.
- No `index.html`, no JavaScript, no iframe. The extension loader skips theme packages during module loading.
- Requires a `theme.json` file at the package root in addition to `manifest.json`.

**Package layout:**
```
my-dark-theme.asyar  (renamed ZIP)
├── manifest.json
├── theme.json
└── fonts/              (optional)
    └── MyFont-Regular.woff2
```

**`manifest.json`:**
```json
{
  "id": "com.yourname.my-dark-theme",
  "name": "My Dark Theme",
  "version": "1.0.0",
  "description": "A custom dark theme for Asyar",
  "author": "Your Name",
  "type": "theme",
  "icon": "icon:palette",
  "asyarSdk": "^1.9.1",
  "minAppVersion": "0.1.0",
  "platforms": ["macos", "linux", "windows"],
  "commands": []
}
```

**`theme.json`:**
```json
{
  "variables": {
    "--bg-primary": "rgba(25, 25, 35, 0.85)",
    "--bg-secondary": "rgba(35, 35, 50, 0.75)",
    "--accent-primary": "rgb(138, 43, 226)",
    "--text-primary": "rgba(255, 255, 255, 0.92)",
    "--font-ui": "\"Inter\", system-ui, sans-serif"
  },
  "fonts": [
    {
      "family": "Inter",
      "weight": "400",
      "style": "normal",
      "src": "fonts/Inter-Regular.woff2"
    }
  ]
}
```

**Variable validation rules:**
- Keys are validated against the Asyar design token allowlist (see [design system tokens](../design-system/tokens.md)). Unknown variable names are silently ignored — they will not apply.
- Only the listed token names are valid override targets. You cannot inject arbitrary CSS properties.

**Font validation rules (enforced at install time):**
- `src` must point to a file inside the package. Path traversal (`..`) is rejected.
- Only `.woff2`, `.ttf`, and `.otf` font files are accepted.
- `family` names must be alphanumeric with spaces and hyphens only. Characters like `;`, `{`, `}`, `url(`, and `@` are rejected to prevent CSS injection.

**Building the `.asyar` package:**
```bash
# Create the ZIP and rename it
zip -r my-dark-theme.zip manifest.json theme.json fonts/
mv my-dark-theme.zip my-dark-theme.asyar
```

**Installing locally:**
1. Open Asyar → Settings → Extensions.
2. Click **Install from File...**.
3. Select your `.asyar` file.
4. The extension appears in your extension list immediately.
5. Navigate to Settings → Appearance → Custom Themes to activate it.

> **Version upgrades:** Installing a `.asyar` with the same ID but a higher version replaces the existing installation. Installing the same or lower version returns an error.
