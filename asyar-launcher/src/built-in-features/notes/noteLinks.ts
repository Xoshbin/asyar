import type { Note } from './noteStore.svelte';

const WIKILINK_RE = /\[\[([^[\]\n]+)\]\]/g;
// A tag starts with a letter (so "#123" and a "###" divider don't count) and
// is not preceded by another word char or '#' (so "issue#123" and Markdown
// headings like "# Heading" — which have a space, not a word char, right
// after '#' — don't match either).
const TAG_RE = /(?<![\w#])#([a-zA-Z][\w-]*)/g;

/** Every `[[Title]]` reference in a note body, trimmed, in order of appearance. */
export function extractWikilinks(body: string): string[] {
  return [...body.matchAll(WIKILINK_RE)].map((m) => m[1].trim());
}

/** Every distinct `#tag` in a note body, first-seen order, without the `#`. */
export function extractTags(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(TAG_RE)) seen.add(m[1]);
  return [...seen];
}

/**
 * Notes that reference `target` by title via a `[[Title]]` link, matched
 * case-insensitively (Obsidian-style: links resolve by name, not by a
 * stable id, so renaming a note can retroactively resolve or break links —
 * that's expected wikilink behavior, not a bug). A note with an empty title
 * can't meaningfully be the target of a link, so it always yields no
 * backlinks. `target` itself is never included even if it self-references.
 */
export function getBacklinks(target: Note, allNotes: Note[]): Note[] {
  const title = target.title.trim().toLowerCase();
  if (!title) return [];
  return allNotes.filter(
    (n) => n.id !== target.id && extractWikilinks(n.body).some((l) => l.toLowerCase() === title),
  );
}

/**
 * The title of the `[[Title]]` reference the cursor sits inside (or
 * immediately after the closing `]]` of), or `null` if the cursor isn't
 * within/adjacent to one. Used by the "follow link under cursor" shortcut.
 */
export function findWikilinkAtCursor(body: string, cursorPos: number): string | null {
  for (const m of body.matchAll(WIKILINK_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (cursorPos >= start && cursorPos <= end) return m[1].trim();
  }
  return null;
}
