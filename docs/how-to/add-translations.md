---
order: 6
---

# How to Add and Maintain Translations

This guide explains how to add new language translations to Asyar and how to use the translation system when authoring launcher UI components or extensions.

---

## 1. Zero Hardcoded Strings Policy

Asyar strictly forbids hardcoded user-facing strings in all Svelte templates and UI code. All user-visible strings must be referenced through translation keys. This applies to `.svelte` **and** `.ts` files: action labels and descriptions, confirmation dialogs, toast and notification messages, status text, and `aria-label` / `title` / `alt` attributes all count.

> **Note:** The automated test only covers part of this policy (see [Static AST Translation Enforcement](../explanation/locale-and-internationalization.md#8-static-ast-translation-enforcement)), so passing CI does not prove a change is fully localized. Review your own diff for literals.

```svelte
<!-- ❌ Bad: Hardcoded string -->
<button class="btn-primary">Save Changes</button>
<FormField label="Extension Name" hint="Choose a unique name" />

<!-- ✅ Good: Localized with t() -->
<button class="btn-primary">{t('features.mcp.save_changes')}</button>
<FormField
  label={t('features.create_extension.extension_name')}
  hint={t('features.create_extension.hint_desc')}
/>
```

---

## 2. Using `t()` in Svelte 5 Components

Import the `t` function from the i18n service:

```typescript
import { t } from '../../services/i18n';
```

### In Templates

```svelte
<p>{t('dialogs.confirm.message')}</p>
<Input placeholder={t('search.placeholder')} />
```

### With Parameters

Translation strings can contain dynamic placeholders like `{count}` or `{name}`:

```typescript
t('features.portals.ui.delete_confirm', { name: portal.name });
```

Never build a sentence with a template literal (`` `Delete "${name}"?` ``). Put the whole sentence in the catalog with a placeholder so translators can reorder it. For plurals, use separate `_one` / `_other` keys and pick between them in code.

### Text With Inline Markup

When a sentence wraps part of itself in an element (`<kbd>`, `<code>`, `<strong>`, a link), split it around the element into `_pre` / `_post` keys instead of using `{@html}`:

```svelte
<p>
  {t('onboarding.summon_lede_pre')} <kbd>{shortcut}</kbd>
  {t('onboarding.summon_lede_mid')}
</p>
```

Keep the element's own text (shortcut, code sample) out of the catalog.

### In Reactive Lists and Arrays (Svelte 5 Runes)

When constructing arrays or objects that contain translated strings, use `$derived` so they automatically re-evaluate if the user switches languages:

```typescript
const categories = $derived([
  {
    key: 'snippets',
    label: t('features.raycast_import.category_snippets'),
    hint: t('features.raycast_import.category_snippets_hint'),
  },
  {
    key: 'portals',
    label: t('features.raycast_import.category_portals'),
    hint: t('features.raycast_import.category_portals_hint'),
  },
]);
```

### In Module-Level Constants

A constant evaluated at import time is computed **once**, before the system locale resolves, so it stays in English. For module-level lists that hold translated text (static search results, help topics, shortcut catalogs), expose the text as getters so it is read at render time:

```typescript
export const LAUNCHER_SHORTCUTS = [
  {
    keys: ['⌘', ','],
    get label() {
      return t('shortcuts_help.open_settings');
    },
    scope: 'global',
  },
] as const;
```

Functions that return strings (for example `systemActionSpecs(os)`) are fine, because `t()` runs on each call.

### In Action Registrations

`actionService.registerAction()` copies `label`, `title`, `description` and `category` as plain strings at registration time, so they do **not** update on their own when the locale changes. Pick the pattern that fits where the action lives:

- **View or selection actions**: register inside a `$effect` and call `t()` directly (below). The effect re-runs when the locale changes.
- **Built-in launcher actions** (`ActionService.registerBuiltInActions`): the service re-registers them when the locale changes, so just call `t()` in the definitions.
- **Categories**: use the shared `categories.*` keys (for example `t('categories.portals')`). Keep internal identifiers such as `clipboard-action` as plain strings.

```typescript
$effect(() => {
  actionService.registerAction({
    id: 'portals:edit',
    title: t('features.portals.action_edit'),
    icon: 'icon:pencil',
    category: t('categories.portals'),
    context: ActionContext.EXTENSION_VIEW,
    execute: () => handleEdit(),
  });

  return () => {
    actionService.unregisterAction('portals:edit');
  };
});
```

### What Not to Translate

- Strings the code compares or matches against. For example, the `Required` prefix of a missing-argument notice is matched by `BottomActionBar`, so changing it means changing both places together.
- Internal identifiers, command IDs and category ids that are never shown.
- Seed data stored in the user's database (default portal names, for instance): translating the source text would not translate rows already saved.
- Brand and technical names (`Asyar`, `GitHub`, CLI names), URLs, shortcodes and example placeholders such as `npx` or `com.example.app`.

### Naming Keys

Group keys by where they are used and keep them under an existing namespace: `common.*` for shared words (`common.cancel`, `common.save`), `categories.*` for action groups, and `features.<feature>.*` for built-in features (for example `features.snippets.act.add` for an action and `features.snippets.ui.*` for view text). Reuse an existing `common.*` key instead of adding a duplicate.

---

## 3. Contributing a New Language Translation

All locale files live in [`asyar-launcher/src/locales/`](../../asyar-launcher/src/locales/).

### Step 1: Create the Locale Catalog

Create a new file named with your target language's BCP-47 / ISO 639-1 code (e.g. `ckb.json` for Central Kurdish, `de.json` for German, `fr.json` for French, `ar.json` for Arabic):

```
asyar-launcher/src/locales/
├── en.json
├── ckb.json
└── de.json
```

### Step 2: Translate Keys

Copy the structure of `en.json` and translate each leaf string value:

```json
{
  "search": {
    "placeholder": "بگەڕێ بۆ بەرنامە و فەرمانەکان...",
    "no_results": "هیچ ئەنجامێک نەدۆزرایەوە",
    "back": "گەڕانەوە"
  },
  "actions": {
    "title": "کردارەکان",
    "open": "کردنەوە",
    "copy": "لەبەرگرتنەوە"
  }
}
```

### Step 3: Register the Catalog

Register your new catalog in [`asyar-launcher/src/services/i18n/i18nService.svelte.ts`](../../asyar-launcher/src/services/i18n/i18nService.svelte.ts) or dynamically via `i18nService.registerCatalog('ckb', ckbCatalog)`.

The catalogs registered today are `en`, `pt-BR`, `zh-CN` and `zh-Hant`. Every catalog must contain exactly the keys of `en.json` and keep the same `{placeholders}`; `catalogs.test.ts` enforces this.

### Step 4: Add the Native (Rust) Strings

A handful of strings are rendered by Rust, outside the frontend catalogs: the tray menu (Settings, Check for Updates, Quit) and some window titles. They live in [`asyar-launcher/src-tauri/src/locale/native.rs`](../../asyar-launcher/src-tauri/src/locale/native.rs):

1. Add a variant to `NativeLang` and map your locale to it in `NativeLang::from_locale`.
2. Add a translation for every `NativeText` key in `native_text` (the `match` is exhaustive, so the compiler tells you what is missing).
3. Extend the tests at the bottom of the file.

Languages without a native table fall back to English for these strings.

---

## 4. Localizing Extension Manifests

Extension manifests support multi-lingual strings directly for properties like `title`, `description`, and command names. Provide either a string (default) or an object keyed by language tags:

```json
{
  "name": "Quick Notes",
  "title": {
    "en": "Quick Notes",
    "ckb": "تێبینی خێرا"
  },
  "description": {
    "en": "Take fast scratch notes from your keyboard",
    "ckb": "تێبینی خێرا بنووسە راستەوخۆ لە کیبۆردەکەتەوە"
  }
}
```

Asyar's [`i18nService.resolveLocalized()`](../../asyar-launcher/src/services/i18n/i18nService.svelte.ts) automatically resolves the best matching translation based on the active system locale and fallback chains.

---

## 5. Verifying Your Translations

Run the i18n tests. They check that every `t()` call references an existing key, that all catalogs have identical keys and placeholders, and that Svelte templates do not contain the most common hardcoded literals:

```bash
pnpm --dir asyar-launcher test:run src/services/i18n/
```

If you touched the native strings, also run:

```bash
cargo test --lib locale
```

Then switch the OS language to the one you changed and check the real app. The automated tests do not cover `.ts` files or every attribute, and they cannot tell you whether a translated sentence overflows a button or reads awkwardly around a `<kbd>` element.

Or run the complete verification check:

```bash
pnpm check:ci
```
