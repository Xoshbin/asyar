import { getItemTitle } from './state.svelte';
import { parseClipboardSearchQuery } from './queryFilterParser';

export interface HighlightChunk {
  text: string;
  match: boolean;
}

export interface ItemDisplay {
  title: string;
  titleChunks?: HighlightChunk[];
  subtitle?: string;
}

/** Delimiters inserted by Rust SQLite FTS5 `snippet()` */
const START_MARKER = '\x01';
const END_MARKER = '\x02';

let cachedQuery: string | null = null;
let cachedTerms: string[] = [];

/**
 * Strip diacritics / accents and convert to lowercase for accent-insensitive
 * token matching (aligning with SQLite FTS5 `unicode61 remove_diacritics 2`).
 */
export function normalizeToken(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Parse a snippet string containing `\x01` (start match) and `\x02` (end match)
 * into a safe array of text chunks for rendering in the UI.
 */
export function parseSnippetChunks(rawSnippet?: string | null): HighlightChunk[] {
  if (!rawSnippet) return [];
  if (!rawSnippet.includes(START_MARKER)) {
    return [{ text: rawSnippet, match: false }];
  }

  const chunks: HighlightChunk[] = [];
  let remaining = rawSnippet;

  while (remaining.length > 0) {
    const startIndex = remaining.indexOf(START_MARKER);
    if (startIndex === -1) {
      chunks.push({ text: remaining, match: false });
      break;
    }

    if (startIndex > 0) {
      chunks.push({ text: remaining.slice(0, startIndex), match: false });
    }

    const afterStart = remaining.slice(startIndex + 1);
    const endIndex = afterStart.indexOf(END_MARKER);
    if (endIndex === -1) {
      // Unclosed start marker: treat the rest as a match
      if (afterStart.length > 0) {
        chunks.push({ text: afterStart, match: true });
      }
      break;
    }

    const matchedText = afterStart.slice(0, endIndex);
    if (matchedText.length > 0) {
      chunks.push({ text: matchedText, match: true });
    }

    remaining = afterStart.slice(endIndex + 1);
  }

  return chunks;
}

/**
 * Compute the title, highlight chunks, and subtitle for a clipboard item.
 *
 * - When not searching: standard preview title, no highlights.
 * - When searching normal item: match-centered snippet with highlighted words.
 * - When searching renamed item with match in title: customTitle with highlighted words.
 * - When searching renamed item with match in body: customTitle as main title, snippet as subtitle.
 */
export function getItemDisplay(
  item: {
    type: string;
    preview?: string;
    customTitle?: string;
    snippet?: string;
  },
  query?: string,
): ItemDisplay {
  if (!item.snippet) {
    return {
      title: getItemTitle(item),
      titleChunks: undefined,
      subtitle: undefined,
    };
  }

  const chunks = parseSnippetChunks(item.snippet);
  const hasMatch = chunks.some((c) => c.match);
  if (!hasMatch) {
    return {
      title: getItemTitle(item),
      titleChunks: undefined,
      subtitle: undefined,
    };
  }

  const plainSnippet = item.snippet.replace(/[\x01\x02]/g, '').trim();

  if (item.customTitle?.trim()) {
    const customTitleTrimmed = item.customTitle.trim();
    // Evaluate the originating query against title tokens; snippet context can
    // overlap a title even when only the body contains a matching token.
    const terms = extractQueryTerms(query);
    const titleTokens = (customTitleTrimmed.match(/[\p{L}\p{N}\p{Co}]+/gu) ?? []).map(
      normalizeToken,
    );
    if (
      terms.length > 0 &&
      terms.every((term) => {
        const normTerm = normalizeToken(term);
        return normTerm.length > 0 && titleTokens.some((token) => token.startsWith(normTerm));
      })
    ) {
      return {
        title: customTitleTrimmed,
        titleChunks: chunks,
        subtitle: undefined,
      };
    }

    return {
      title: customTitleTrimmed,
      titleChunks: [{ text: customTitleTrimmed, match: false }],
      subtitle: plainSnippet || undefined,
    };
  }

  return {
    title: plainSnippet || getItemTitle(item),
    titleChunks: chunks,
    subtitle: undefined,
  };
}

/**
 * Extract clean search term words from the user's query string, stripping
 * filter tokens like `type:...` and `app:...`.
 */
export function extractQueryTerms(query?: string | null): string[] {
  if (!query?.trim()) return [];
  if (query === cachedQuery) return cachedTerms;
  const parsed = parseClipboardSearchQuery(query);
  const text = parsed.textQuery.trim();
  if (!text) {
    cachedQuery = query;
    cachedTerms = [];
    return [];
  }
  // unicode61's default token categories are letters, numbers and private use.
  const terms = text.match(/[\p{L}\p{N}\p{Co}]+/gu) ?? [];
  cachedQuery = query;
  cachedTerms = terms;
  return terms;
}

/**
 * Highlight matching query terms directly in the DOM of a container element
 * (e.g. the clipboard detail preview body).
 *
 * Operates strictly on `NodeFilter.SHOW_TEXT` nodes, ensuring zero corruption
 * of HTML tags or attributes and zero XSS vulnerability.
 */
export function highlightInElement(
  container: HTMLElement | null | undefined,
  query?: string | null,
): void {
  if (!container) return;

  // 1. Remove any previous search highlight marks, restoring plain text
  const existingMarks = Array.from(container.querySelectorAll('mark.search-match'));
  if (existingMarks.length > 0) {
    const parentsToNormalize = new Set<Node>();
    for (const mark of existingMarks) {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parentsToNormalize.add(parent);
      }
    }
    for (const parent of parentsToNormalize) {
      parent.normalize();
    }
  }

  const terms = extractQueryTerms(query);
  if (terms.length === 0) return;

  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(?<![\\p{L}\\p{N}\\p{Co}])(${escaped.join('|')})`, 'giu');

  // Fast path: if the container's entire text content has no match, avoid TreeWalker
  if (!regex.test(container.textContent || '')) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parentTag = node.parentElement?.tagName;
    if (parentTag !== 'SCRIPT' && parentTag !== 'STYLE') {
      textNodes.push(node as Text);
    }
  }

  let firstMatch: HTMLElement | null = null;
  let matchCount = 0;
  const MAX_HIGHLIGHT_MATCHES = 100;

  for (const textNode of textNodes) {
    const val = textNode.nodeValue;
    if (!val) continue;

    regex.lastIndex = 0;
    if (!regex.test(val)) continue;

    regex.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(val)) !== null) {
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(val.slice(lastIdx, match.index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-match';
      mark.textContent = match[0];
      if (!firstMatch) firstMatch = mark;
      frag.appendChild(mark);
      lastIdx = regex.lastIndex;

      matchCount++;
      if (matchCount >= MAX_HIGHLIGHT_MATCHES) {
        break;
      }
    }

    if (lastIdx < val.length) {
      frag.appendChild(document.createTextNode(val.slice(lastIdx)));
    }

    textNode.parentNode?.replaceChild(frag, textNode);
    if (matchCount >= MAX_HIGHLIGHT_MATCHES) {
      break;
    }
  }

  if (firstMatch && typeof firstMatch.scrollIntoView === 'function') {
    firstMatch.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }
}
