---
order: 6
---

# How to Add and Maintain Translations

This guide explains how to add new language translations to Asyar and how to use the translation system when authoring launcher UI components or extensions.

---

## 1. Zero Hardcoded Strings Policy

Asyar strictly forbids hardcoded user-facing strings in all Svelte templates and UI code. All user-visible strings must be referenced through translation keys.

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
t('features.portals.delete_message', { name: portal.name });
```

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

### In Action Registrations

For actions registered via `actionService.registerAction()` inside `$effect` blocks, call `t()` directly:

```typescript
$effect(() => {
  actionService.registerAction({
    id: 'portals:edit',
    title: t('features.portals.action_edit'),
    icon: 'icon:pencil',
    category: 'Portals',
    context: ActionContext.EXTENSION_VIEW,
    execute: () => handleEdit(),
  });

  return () => {
    actionService.unregisterAction('portals:edit');
  };
});
```

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

Run the automated static analysis test to ensure no hardcoded strings or broken keys exist:

```bash
pnpm --dir asyar-launcher test:run src/services/i18n/
```

Or run the complete verification check:

```bash
pnpm check:ci
```
