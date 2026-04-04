/**
 * Strip HTML tags, script/style blocks, and decode common entities.
 * Uses regex — no DOM dependency, works in all environments.
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip RTF control words, unicode escapes, braces, and backslashes.
 */
export function stripRtf(rtf: string): string {
  if (!rtf) return '';
  return rtf
    .replace(/\\u-?\d+\??/g, '')
    .replace(/\\[a-z]+-?\d*\s?/gi, '')
    .replace(/[{}\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
