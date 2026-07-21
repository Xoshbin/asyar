// Live-editing helpers only. Anything that scans the persisted note corpus —
// backlinks, resolving links across notes — lives in Rust (storage::notes).
// These two run against the actively-typed textarea buffer every keystroke,
// which is exactly the sub-frame UI-feedback / cursor-and-keyboard work the
// rust-first skill keeps on the frontend.

// A tag starts with a letter (so "#123" and a "###" divider don't count) and
// is not preceded by a word char or '#' (so "issue#123" and "# Heading" — a
// space after '#', not a word char — don't match).
const TAG_RE = /(?<![\w#])#([a-zA-Z][\w-]*)/g;
const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;

/** Distinct `#tag`s in the live editor buffer, first-seen order, without `#`. */
export function extractTags(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) seen.add(m[1]);
  return [...seen];
}

/**
 * Title of the `[[Title]]` reference the cursor sits inside (or just after the
 * closing `]]`), or null. Drives the ⌘Enter "follow link under cursor" key.
 */
export function findWikilinkAtCursor(body: string, cursorPos: number): string | null {
  for (const m of body.matchAll(WIKILINK_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (cursorPos >= start && cursorPos <= end) return m[1].trim();
  }
  return null;
}
