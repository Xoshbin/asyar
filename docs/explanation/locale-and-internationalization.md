---
order: 11
---

# Locale Subsystem & Internationalization

Asyar centralizes all locale resolution, tag parsing, candidate chain generation, and CLDR formatting inside the Rust host (`asyar-launcher/src-tauri/src/locale/`). This page explains the architectural principles, data models, and resolution strategies governing internationalization across the platform.

---

## 1. Architectural Philosophy: Rust-First Locale

In accordance with Asyar's **Rust-First Principle**, all locale parsing, candidate resolution, region evaluation, and number notation transformations live entirely in the Rust core.

```
┌────────────────────────────────────────────────────────┐
│                   Operating System                     │
│         (macOS defaults / POSIX locale / XDG)          │
└───────────────────────────┬────────────────────────────┘
                            │ sys_locale::get_locale()
┌───────────────────────────▼────────────────────────────┐
│              Locale Subsystem (crate::locale)          │
│                                                        │
│  - ParsedLocale (BCP-47 / POSIX parser & normalizer)   │
│  - Candidate Resolvers (UI Text, macOS, Linux XDG)     │
│  - CLDR Number Notation (Point vs Comma, canonicalize) │
│  - LocaleService (Tauri state manager & OS refresh)    │
└───────────┬─────────────────┬──────────────────┬───────┘
            │                 │                  │
┌───────────▼───────┐ ┌───────▼────────┐ ┌───────▼───────┐
│ macOS loctables   │ │ Linux .desktop │ │  Calculator   │
│ (display_name.rs) │ │ (desktop_entry)│ │  (locale.rs)  │
└───────────────────┘ └────────────────┘ └───────────────┘
```

The frontend and extension layers remain thin presenters that query or receive structured locale types (`ParsedLocale`, `NumberFormat`) over typed IPC bindings.

---

## 2. Core Model: `ParsedLocale`

All locale tags are parsed into a canonical, structured [`ParsedLocale`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri/src/locale/bcp47.rs):

```rust
pub struct ParsedLocale {
    pub language: String,        // 2- or 3-letter lowercase ISO 639 (e.g. "en", "zh", "de")
    pub script: Option<String>,  // 4-letter Titlecase ISO 15924 (e.g. "Hans", "Hant", "Latn")
    pub region: Option<String>,  // 2-letter uppercase ISO 3166-1 or 3-digit UN M.49 (e.g. "US", "DE", "419")
    pub variant: Option<String>, // Subtag variant (e.g. "1901")
    pub raw: String,             // Original input string
}
```

### Normalization Guarantees

- **Separator Neutrality**: Handles both `-` (BCP-47) and `_` (POSIX / Apple).
- **POSIX Cleaning**: Strips `.codeset` (e.g. `.UTF-8`) and maps POSIX modifiers (`sr_RS@latin` → language `sr`, script `Latn`, region `RS`).
- **Extension Isolation**: Ignores BCP-47 singleton extensions (`-u-`, `-t-`, `-x-`) so that tags like `zh-Hans-CN-u-ca-chinese` resolve cleanly to `zh-Hans-CN`.

---

## 3. The Core Duality: Language-First vs. Region-First

A fundamental rule in internationalization architecture is that **text resolution** and **number/data formatting** follow opposing priority hierarchies:

### A. Language-First Strategy (Text & Asset Resolution)

When choosing which translation or localized asset to present, the spoken language and script take precedence over geographical borders:

- **Generic Fallback Chain** (`text_candidates()`):
  `zh-Hans-CN` → `zh-CN` → `zh-Hans` → `zh`
- **macOS Bundle Resolution** (`macos_bundle_candidates()`):
  - Emits both hyphenated and underscored keys (`zh-Hans-CN`, `zh_Hans_CN`, `zh-CN`, `zh_CN`).
  - Drops script subtags to match Apple's underscore-keyed regional tables (`zh_CN`, `pt_PT`, `en_GB`, `es_419`).
  - Maps Chinese script to regional tables (`zh-Hans` → `zh_CN`, `zh-Hant` → `zh_TW`/`zh_HK`).
- **Linux XDG Desktop Entry Resolution** (`desktop_entry_candidates()`):
  - Resolves `Name[locale]` entries against full raw tags, POSIX tags (`de_DE`), BCP-47 tags (`de-DE`), and base language (`de`).

### B. Region-First Strategy (CLDR Number Formatting & Units)

When formatting numbers, currencies, and physical units, the user's regional environment dictates the notation:

- An English speaker living in Germany (`en-DE`) expects comma-decimal notation (`1.234,56`) and metric units, despite using an English UI.
- **Rules evaluated in order**:
  1. If region is present, match CLDR comma-decimal region tables (`DE`, `FR`, `BR`, `ES`, `TR`, `NL`, etc.).
  2. Special regional exceptions:
     - **Canada (`CA`)**: Split by language (`fr-CA` writes `1 234,56`, `en-CA` writes `1,234.56`).
     - **Switzerland (`CH` / `LI`)**: Writes point-decimal (`1'234.56`), even for German/French UI.
     - **Latin America (`MX`, `PE`, `CO`, etc.)**: Writes point-decimal (`1,234.56`).
  3. If region is absent, fallback to language default (`de` → Comma, `en` → Point).

---

## 4. Calculator Pipeline & Canonicalization

The natural-language calculator evaluates expressions in a canonical `1,234.56` notation. The locale subsystem bridges comma-decimal regions via two symmetric transformations:

1. **[`canonicalize_input(query, format)`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri/src/locale/number_format.rs)**:
   - Rewrites input queries before evaluation (`61,78 * 1,19` → `61.78 * 1.19`, `1.234,56` → `1234.56`).
   - Protects list commas in color functions (`rgb(255,0,0)`) and dates (`25.12.2026`).
2. **[`localize_output(text, format)`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src-tauri/src/locale/number_format.rs)**:
   - Rewrites output answers after evaluation (`73.5182` → `73,5182`, `1,234,567` → `1.234.567`).

---

## 5. `LocaleService` & Runtime OS Refresh

`LocaleService` is registered in Tauri's managed state container (`app.manage(LocaleService::new())`).

- **Thread-Safe**: Uses `std::sync::RwLock` for fast concurrent reads during search indexing and query evaluation.
- **Dynamic Refresh**: Calling `locale_service.refresh_from_system()` checks the host OS settings via `sys_locale` and updates the active `ParsedLocale` without requiring an application restart.
- **User Overrides**: Allows the user to explicitly override their preferred decimal notation (`"point"` or `"comma"`) or leave it set to `"auto"` (following the system region).

---

## 6. IPC Commands & TypeScript Bindings

The following Tauri commands are exposed for frontend and extension consumption:

- `get_system_locale()` → Returns `ParsedLocale`
- `get_locale_candidates(locale: string)` → Returns `string[]`

TypeScript types are automatically derived via `specta` in [`src/bindings.ts`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src/bindings.ts):

```typescript
export type NumberFormat = 'point' | 'comma';

export type ParsedLocale = {
  language: string;
  script: string | null;
  region: string | null;
  variant: string | null;
  raw: string;
};
```

---

## 7. Frontend I18n Architecture (`I18nService` & Catalogs)

On the presentation layer, [`I18nService`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src/services/i18n/i18nService.svelte.ts) consumes the system locale and resolves translated strings reactively:

- **Candidate Fallback Chains**: When looking up a key (e.g. for `zh-Hans-CN`), the service checks `zh-Hans-CN` → `zh-Hans` → `zh` → `en` before falling back to the raw key.
- **Dynamic Parameter Interpolation**: `t('features.mcp.detected_configs_description', { sources: 'VS Code' })` dynamically replaces `{param}` placeholders.
- **Extension Manifest Localization**: `resolveLocalized(value, fallback)` transparently resolves multi-lingual JSON objects (`{ "en": "Clear", "ckb": "سڕینەوە" }`) declared in extension manifests.
- **Svelte 5 Reactivity**: The global `t` helper works seamlessly with Svelte 5 `$derived` state, ensuring all labels, placeholders, and action titles update instantly when the active locale changes.

---

## 8. Static AST Translation Enforcement

To guarantee that no untranslated text reaches production, Asyar implements an automated AST static analysis test suite in [`noHardcodedStrings.test.ts`](file:///Users/khoshbin/develop/Asyar-Project/asyar-launcher/src/services/i18n/noHardcodedStrings.test.ts):

1. **Catalog Integrity**: Ensures every `t("key")` call references an existing, non-empty key in `en.json`.
2. **Template Sensitive Props**: Scans all Svelte component invocations and HTML tags to prevent literal strings on sensitive props (`label`, `description`, `placeholder`, `message`, `emptyMessage`, `kicker`, `hint`, `subtitle`, `error`).
3. **Interactive Elements**: Asserts that all text inside interactive elements (`<button>`, `<Button>`, `<option>`, `<label>`) is wrapped with `{t('...')}`.
4. **Script Block Literals**: Walks AST property nodes in `<script>` blocks to catch unlocalized action definitions, default prop assignments, and notification payloads.
5. **Technical Whitelisting**: Employs an exact heuristic (`isTechnicalOrSymbol`) to permit symbols (⌘K, +), numbers/units (12px, 100%), paths/URLs, and recognized system identifiers (e.g. `github`, `tauri`, `json`).
