/**
 * Extract unique `{Token}` placeholders from a URL, in first-occurrence order.
 *
 * Examples:
 *   parseUrlPlaceholders('https://x.com/?q={Query}&q2={Query}')
 *     // → ['Query']
 *   parseUrlPlaceholders('https://x.com/?q={Query}&from={Clipboard Text}')
 *     // → ['Query', 'Clipboard Text']
 *
 * Empty braces `{}` and unclosed `{` are ignored.
 */
export function parseUrlPlaceholders(url: string): string[] {
  const regex = /\{([^{}]+)\}/g;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of url.matchAll(regex)) {
    const token = match[1];
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }

  return result;
}
