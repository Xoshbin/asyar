/** Mirrors the fields this module reads off a real IntersectionObserverEntry
 *  (`target.id`, `boundingClientRect.top`, `isIntersecting`) as plain data,
 *  so the picking logic is testable without a DOM/IntersectionObserver. */
export interface SectionIntersection {
  id: string;
  top: number;
  isIntersecting: boolean;
}

/** Scrollspy: of the sections currently intersecting the scroll root, pick
 *  the one closest to the top (smallest `top`) — the one the user is
 *  reading right now. Falls back to the previous active id (or null) when
 *  nothing currently intersects, so the pill row doesn't flicker to "none
 *  active" between sections. */
export function pickActiveSection(
  entries: SectionIntersection[],
  fallback: string | null,
): string | null {
  const visible = entries.filter((e) => e.isIntersecting);
  if (visible.length === 0) return fallback;
  return visible.reduce((topmost, e) => (e.top < topmost.top ? e : topmost)).id;
}
