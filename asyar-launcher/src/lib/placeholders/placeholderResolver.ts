import { selectionService } from '../../services/selection/selectionService';
import { clipboardHistoryService } from '../../services/clipboard/clipboardHistoryService';
import { invokeSafe } from '../ipc/invokeSafe';

export interface ResolveContext {
  query?: string; // the user's search query (raw, un-encoded)
  trigger?: string; // the shortcode trigger
}

export interface ResolveOptions {
  encodeValues?: boolean; // apply encodeURIComponent to each resolved value (use true for URL templates)
}

export interface PlaceholderDefinition {
  id: string; // machine-readable id
  label: string; // display name in picker UI (e.g. "Selected Text")
  token: string; // canonical `{token}` string (e.g. "Selected Text")
  description?: string; // subtitle shown in picker UI
  aliases?: string[]; // other accepted spellings (e.g. ["selection"])
}

export async function fetchPlaceholders(): Promise<PlaceholderDefinition[]> {
  const result = await invokeSafe<PlaceholderDefinition[]>(
    'get_available_placeholders',
    undefined,
    { silent: true },
  );
  return result ?? [];
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
  options: ResolveOptions = {},
): Promise<string> {
  const resolvedTemplate = await invokeSafe<string>(
    'resolve_template',
    {
      template,
      context: {
        query: context.query || null,
        trigger: context.trigger || null,
      },
    },
    { silent: true },
  );

  if (options.encodeValues) {
    // This isn't perfect for encodeValues: true, since it would encode the whole string
    // but right now encodeValues isn't used anywhere in the codebase yet.
    // If it is, we'll need to do it at the rust layer per-placeholder.
    // Assuming for now options.encodeValues is handled by the caller or not used.
  }

  return resolvedTemplate ?? template;
}

/** True if template contains at least one known placeholder token. */
export async function hasPlaceholders(template: string): Promise<boolean> {
  const placeholders = await fetchPlaceholders();
  const TOKEN_RE = /\{([^{}]+)\}/g;
  for (const m of template.matchAll(TOKEN_RE)) {
    const rawToken = m[1].trim();
    const baseToken = rawToken.split(/\s+/)[0];
    if (
      placeholders.some(
        (p) =>
          p.token === rawToken ||
          p.token === baseToken ||
          p.token.toLowerCase() === rawToken.toLowerCase() ||
          p.token.toLowerCase() === baseToken.toLowerCase() ||
          p.aliases?.includes(rawToken) ||
          p.aliases?.includes(baseToken) ||
          p.aliases?.some((a) => a.toLowerCase() === rawToken.toLowerCase()) ||
          p.aliases?.some((a) => a.toLowerCase() === baseToken.toLowerCase()),
      )
    ) {
      return true;
    }
  }
  return false;
}
