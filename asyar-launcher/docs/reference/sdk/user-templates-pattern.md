### 8.15 Pattern: user-authored templates with dynamic values

**No SDK service required.** This is a cookbook recipe showing how to build dynamic placeholder substitution — the same `{clipboard}` / `{Selected Text}` / `{Date}` token style used by the built-in **Portals** and **Snippets** features — using only existing SDK services. Asyar deliberately does not expose a `PlaceholderService` because the primitives needed to build one are already available: `IClipboardHistoryService.readCurrentText()`, `ISelectionService.getSelectedText()`, and the JavaScript standard library (`crypto.randomUUID()`, `new Date()...`). Rolling your own resolver keeps the permission model explicit — your extension declares exactly what it needs in `manifest.json` — and lets you choose the token names and set that fit your feature.

**When to use this pattern:** your extension lets the user author a template string (a URL, a shell command template, a text snippet) and you want to substitute dynamic values into it at invocation time.

**Permissions to declare.** Add to your `manifest.json` only the permissions the tokens you actually offer require:

```json
{
  "permissions": ["clipboard:read", "selection:read"]
}
```

- `clipboard:read` — required if you offer a `{clipboard}` / `{Clipboard Text}` token.
- `selection:read` — required if you offer a `{selection}` / `{Selected Text}` token.
- No permission needed for date/time/UUID/user-input tokens — those come from the JavaScript runtime.

**Minimal resolver implementation.** Drop this into your extension (e.g. `src/lib/templates.ts`). It mirrors the built-in launcher's semantics: tokens are deduplicated so each is resolved once even if it appears multiple times; unknown tokens are left untouched; async tokens are resolved concurrently; service failures degrade to empty strings.

```typescript
import type { IClipboardHistoryService, ISelectionService } from 'asyar-sdk';

interface ResolveContext { query?: string; }
interface ResolveOptions { encodeValues?: boolean; }
type TokenResolver = (ctx: ResolveContext) => string | Promise<string>;

export function createTemplateResolver(
  clipboard: IClipboardHistoryService,
  selection: ISelectionService,
) {
  // Token registry — add, rename, or remove to match your feature's UX.
  // The canonical spellings below match Asyar's built-in Portals/Snippets
  // so your users get consistent muscle memory.
  const tokens: Record<string, TokenResolver> = {
    query:            (ctx) => ctx.query ?? '',
    Argument:         (ctx) => ctx.query ?? '',
    'Selected Text':  async () => (await selection.getSelectedText()) ?? '',
    selection:        async () => (await selection.getSelectedText()) ?? '',
    'Clipboard Text': () => clipboard.readCurrentText(),
    clipboard:        () => clipboard.readCurrentText(),
    UUID:             () => crypto.randomUUID(),
    Date:             () => new Date().toLocaleDateString(),
    Time:             () => new Date().toLocaleTimeString(),
    'Date & Time':    () => new Date().toLocaleString(),
    Weekday:          () => new Date().toLocaleDateString(undefined, { weekday: 'long' }),
  };

  async function resolveTemplate(
    template: string,
    context: ResolveContext = {},
    options: ResolveOptions = {},
  ): Promise<string> {
    const TOKEN_RE = /\{([^{}]+)\}/g;
    const unique = [...new Set([...template.matchAll(TOKEN_RE)].map((m) => m[1]))];
    if (unique.length === 0) return template;

    const resolved = new Map<string, string>();
    await Promise.all(
      unique.map(async (name) => {
        const fn = tokens[name];
        if (!fn) return; // unknown token → left as {name} in output
        try {
          const value = await fn(context);
          resolved.set(name, options.encodeValues ? encodeURIComponent(value) : value);
        } catch {
          resolved.set(name, ''); // service failure → empty string
        }
      }),
    );

    return template.replace(TOKEN_RE, (full, name) =>
      resolved.has(name) ? resolved.get(name)! : full,
    );
  }

  function hasPlaceholders(template: string): boolean {
    const TOKEN_RE = /\{([^{}]+)\}/g;
    for (const m of template.matchAll(TOKEN_RE)) {
      if (tokens[m[1]]) return true;
    }
    return false;
  }

  return { resolveTemplate, hasPlaceholders };
}
```

**Usage from a command handler:**

```typescript
import type {
  ExtensionContext,
  IClipboardHistoryService,
  ISelectionService,
} from 'asyar-sdk';
import { createTemplateResolver } from './lib/templates';

let resolver: ReturnType<typeof createTemplateResolver>;

export async function initialize(context: ExtensionContext) {
  const clipboard = context.getService<IClipboardHistoryService>('ClipboardHistoryService');
  const selection = context.getService<ISelectionService>('SelectionService');
  resolver = createTemplateResolver(clipboard, selection);
}

export async function openTemplatedUrl(template: string, query: string) {
  // For URL contexts, pass encodeValues: true so {clipboard}, {Selected Text},
  // etc. are percent-encoded safely into query strings.
  const url = await resolver.resolveTemplate(
    template,
    { query },
    { encodeValues: true },
  );
  window.open(url, '_blank');
}

// Example template the user could store in your extension's settings:
//   https://translate.google.com/?sl=auto&tl=en&text={Selected Text}
```

**Matching the built-in token set.** If you want your extension's tokens to feel native, use the names and aliases above verbatim — they match the Portals and Snippets built-in features one-for-one. Users who already know how to author a portal URL will know how to author your template.

**Error handling notes.** `getSelectedText()` can throw a `SelectionError` — in particular `ACCESSIBILITY_PERMISSION_REQUIRED` on macOS when the user hasn't granted accessibility access. The resolver above swallows these into empty strings for template-filling convenience, but if your extension is the user's first experience with selection reading, wrap the first call in an explicit try/catch and use `IFeedbackService.showToast` to guide them into System Settings. See §8.14 for the full `SelectionError` handling pattern.

**Why isn't there a built-in `PlaceholderService`?** The primary reason is architectural. As covered in §4's **two-tier model**, Asyar's launcher features (Tier 1) run in the privileged SvelteKit host context with direct access to internal services, while third-party extensions (Tier 2) run in sandboxed `<iframe>`s whose only channel to the host is serializable `postMessage` IPC. **Asyar does not — and has no plans to — share launcher components or internal module code across that boundary. The SDK exposes service interfaces only; never UI components, Svelte code, or internal implementations.** The launcher's placeholder resolver and its `{` picker are Tier 1 Svelte code that directly imports concrete launcher services, so "just exposing the built-in" isn't a small refactor — it would mean designing a separate IPC-routed service surface from scratch and solving the picker-in-iframe problem on the extension side. On top of that, a packaged `PlaceholderService` would bundle `clipboard:read` and `selection:read` behind an implicit contract, and extensions would pay for the whole permission set even if they only wanted date/time tokens. Keeping the pattern in user-land lets each extension declare exactly the permissions it uses, choose its own token names, and add tokens Asyar doesn't ship (e.g. a `{current_project}` token scoped to a project-tracking extension).

---
