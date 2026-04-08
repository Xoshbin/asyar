import { selectionService } from '../../services/selection/selectionService';
import { ClipboardHistoryService } from '../../services/clipboard/clipboardHistoryService';

export interface ResolveContext {
  query?: string; // the user's search query (raw, un-encoded)
}

export interface ResolveOptions {
  encodeValues?: boolean; // apply encodeURIComponent to each resolved value (use true for URL templates)
}

export interface PlaceholderDefinition {
  id: string;          // machine-readable id
  label: string;       // display name in picker UI (e.g. "Selected Text")
  token: string;       // canonical `{token}` string (e.g. "Selected Text")
  description?: string; // subtitle shown in picker UI
  aliases?: string[];  // other accepted spellings (e.g. ["selection"])
  resolve(context: ResolveContext): Promise<string> | string;
}

// All supported placeholders — add new ones here, picker/resolver pick them up automatically
export const PLACEHOLDERS: readonly PlaceholderDefinition[] = [
  {
    id: 'query',
    label: 'Search Query',
    token: 'query',
    description: 'The text typed in the search bar when running the portal',
    aliases: ['Argument'],
    resolve: (ctx) => ctx.query ?? '',
  },
  {
    id: 'selected-text',
    label: 'Selected Text',
    token: 'Selected Text',
    description: 'Text currently selected in the frontmost app',
    aliases: ['selection'],
    resolve: async () => {
      try { return (await selectionService.getSelectedText()) ?? ''; }
      catch { return ''; }
    },
  },
  {
    id: 'clipboard-text',
    label: 'Clipboard Text',
    token: 'Clipboard Text',
    description: 'Current text content of the clipboard',
    aliases: ['clipboard'],
    resolve: async () => {
      try { return await ClipboardHistoryService.getInstance().readCurrentText(); }
      catch { return ''; }
    },
  },
  {
    id: 'uuid',
    label: 'UUID',
    token: 'UUID',
    description: 'A randomly generated UUID v4',
    resolve: (ctx) => {
      // If the query bar was pre-filled with a UUID, reuse it for consistency
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (ctx.query && UUID_RE.test(ctx.query)) return ctx.query;
      return crypto.randomUUID();
    },
  },
  {
    id: 'date',
    label: 'Date',
    token: 'Date',
    description: "Today's date (e.g. 4/7/2026)",
    resolve: () => new Date().toLocaleDateString(),
  },
  {
    id: 'time',
    label: 'Time',
    token: 'Time',
    description: 'Current time (e.g. 3:45:00 PM)',
    resolve: () => new Date().toLocaleTimeString(),
  },
  {
    id: 'date-time',
    label: 'Date & Time',
    token: 'Date & Time',
    description: "Today's date and current time",
    resolve: () => new Date().toLocaleString(),
  },
  {
    id: 'weekday',
    label: 'Weekday',
    token: 'Weekday',
    description: 'Current day name (e.g. Tuesday)',
    resolve: () => new Date().toLocaleDateString(undefined, { weekday: 'long' }),
  },
];

// Internal: find a placeholder by its canonical token or any alias
function findPlaceholder(tokenText: string): PlaceholderDefinition | undefined {
  return PLACEHOLDERS.find(p => p.token === tokenText || p.aliases?.includes(tokenText));
}

/**
 * Resolve all `{token}` placeholders in a template string.
 *
 * Unknown `{token}` strings are left untouched.
 * Each known token is resolved exactly once (even if it appears multiple times).
 *
 * @param template  The template string, e.g. "https://google.com/search?q={query}&date={Date}"
 * @param context   Runtime context (e.g. { query: 'hello' })
 * @param options   { encodeValues: true } for URL contexts
 */
export async function resolveTemplate(
  template: string,
  context: ResolveContext = {},
  options: ResolveOptions = {}
): Promise<string> {
  const TOKEN_RE = /\{([^{}]+)\}/g;
  const matches = [...template.matchAll(TOKEN_RE)];
  if (matches.length === 0) return template;

  // Resolve each unique token once (concurrent resolution for async tokens)
  const uniqueTokens = [...new Set(matches.map(m => m[1]))];
  const resolved = await Promise.all(
    uniqueTokens.map(async (tokenText) => {
      const def = findPlaceholder(tokenText);
      if (!def) return [tokenText, null] as const; // null = leave as-is
      const value = await def.resolve(context);
      return [tokenText, options.encodeValues ? encodeURIComponent(value) : value] as const;
    })
  );
  const valueMap = new Map(resolved.filter(([, v]) => v !== null) as [string, string][]);

  return template.replace(TOKEN_RE, (fullMatch, tokenText) =>
    valueMap.has(tokenText) ? valueMap.get(tokenText)! : fullMatch
  );
}

/** True if template contains at least one known placeholder token. */
export function hasPlaceholders(template: string): boolean {
  const TOKEN_RE = /\{([^{}]+)\}/g;
  for (const m of template.matchAll(TOKEN_RE)) {
    if (findPlaceholder(m[1])) return true;
  }
  return false;
}
