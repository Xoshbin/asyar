import type { CommandArgument } from 'asyar-sdk/contracts';
import { t } from '../../services/i18n';

const MAX_PORTAL_ARGUMENTS = 3;

const KNOWN_PLACEHOLDER_NAMES = new Set([
  'argument',
  'query',
  'clipboard',
  'clipboard-text',
  'clipboard text',
  'selection',
  'selected-text',
  'selected text',
  'date',
  'time',
  'datetime',
  'date-time',
  'date & time',
  'weekday',
  'day',
  'uuid',
]);

const PARAM_RE = /([a-zA-Z_][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;

/** Sanitize an argument display name into `/^[a-zA-Z_][a-zA-Z0-9_]*$/` matching Rust. */
export function sanitizePortalArgName(raw: string): string {
  let cleaned = '';
  for (const ch of raw) {
    cleaned += /^[a-zA-Z0-9_]$/.test(ch) ? ch : '_';
  }
  if (!cleaned || /^[0-9]/.test(cleaned)) {
    return `arg_${cleaned}`;
  }
  return cleaned;
}

function splitUnquotedPipes(input: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '|') {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(input.slice(start));
  return parts;
}

export interface ParsedPlaceholder {
  name: string;
  params: Record<string, string>;
  modifiers: string[];
}

export function parsePlaceholderInner(raw: string): ParsedPlaceholder | null {
  const parts = splitUnquotedPipes(raw);
  const head = (parts[0] ?? '').trim();
  if (!head) return null;

  const params: Record<string, string> = {};
  let firstParamStart = head.length;
  PARAM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PARAM_RE.exec(head)) !== null) {
    if (match.index < firstParamStart) {
      firstParamStart = match.index;
    }
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    params[key] = val;
  }

  const name = head.slice(0, firstParamStart).trim();
  if (!name) return null;

  const modifiers = parts
    .slice(1)
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);

  return { name, params, modifiers };
}

export function isKnownPortalPlaceholder(rawInner: string): boolean {
  const parsed = parsePlaceholderInner(rawInner);
  if (!parsed) return false;
  const lower = parsed.name.toLowerCase();
  if (!KNOWN_PLACEHOLDER_NAMES.has(lower)) return false;
  if (parsed.params.format && parsed.params.locale) return false;
  return true;
}

/**
 * Extract up to 3 CommandArgument definitions from a Portal link template.
 * Supports `{argument}`, `{argument name="Query" default="..." options="a, b"}`,
 * and legacy `{query}` / `{Query}` / `{Argument}`.
 */
export function extractPortalArguments(url: string): CommandArgument[] {
  const seenDisplayNames = new Set<string>();
  const usedKeys = new Set<string>();
  const collected: CommandArgument[] = [];
  const TOKEN_RE = /\{([^{}]+)\}/g;

  for (const match of url.matchAll(TOKEN_RE)) {
    const parsed = parsePlaceholderInner(match[1]);
    if (!parsed) continue;
    const lower = parsed.name.toLowerCase();
    if (lower !== 'argument' && lower !== 'query') continue;

    const rawName = parsed.params.name?.trim() || (parsed.name === 'Query' ? 'Query' : 'Argument');
    if (seenDisplayNames.has(rawName)) continue;
    if (collected.length >= MAX_PORTAL_ARGUMENTS) break;
    seenDisplayNames.add(rawName);

    const displayName =
      parsed.params.name?.trim() ||
      t(
        parsed.name === 'Query'
          ? 'features.portals.ui.defaultQueryPlaceholder'
          : 'features.portals.ui.defaultArgumentPlaceholder',
      );

    const baseKey = sanitizePortalArgName(rawName);
    let argKey = baseKey;
    let suffix = 2;
    while (usedKeys.has(argKey)) {
      argKey = `${baseKey}_${suffix++}`;
    }
    usedKeys.add(argKey);

    const optionsRaw = parsed.params.options;
    const defaultVal = parsed.params.default;
    const hasDefault = defaultVal !== undefined;

    if (optionsRaw !== undefined && optionsRaw.trim().length > 0) {
      const items = optionsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length > 0) {
        const defaultOpt = hasDefault && items.includes(defaultVal) ? defaultVal : items[0];
        collected.push({
          name: argKey,
          type: 'dropdown',
          placeholder: displayName,
          required: !hasDefault,
          default: hasDefault ? defaultOpt : undefined,
          data: items.map((item) => ({ title: item, value: item })),
        });
        continue;
      }
    }

    collected.push({
      name: argKey,
      type: 'text',
      placeholder: displayName,
      required: !hasDefault,
      default: hasDefault ? defaultVal : undefined,
    });
  }

  // Rust dynamic command validation requires required arguments to precede optional ones.
  const required = collected.filter((a) => a.required);
  const optional = collected.filter((a) => !a.required);
  return [...required, ...optional];
}

export interface LinkSegment {
  text: string;
  isPlaceholder: boolean;
  isArgument: boolean;
}

/** Tokenize a portal URL into literal and valid placeholder segments. */
export function tokenizePortalLink(url: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  const TOKEN_RE = /\{([^{}]+)\}/g;
  let lastIndex = 0;

  for (const match of url.matchAll(TOKEN_RE)) {
    const idx = match.index ?? 0;
    if (idx > lastIndex) {
      segments.push({
        text: url.slice(lastIndex, idx),
        isPlaceholder: false,
        isArgument: false,
      });
    }
    const inner = match[1];
    const valid = isKnownPortalPlaceholder(inner);
    const parsed = valid ? parsePlaceholderInner(inner) : null;
    const isArg =
      parsed !== null &&
      (parsed.name.toLowerCase() === 'argument' || parsed.name.toLowerCase() === 'query');

    segments.push({
      text: match[0],
      isPlaceholder: valid,
      isArgument: isArg,
    });
    lastIndex = idx + match[0].length;
  }

  if (lastIndex < url.length) {
    segments.push({
      text: url.slice(lastIndex),
      isPlaceholder: false,
      isArgument: false,
    });
  }

  return segments;
}
