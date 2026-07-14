const SCROLL_PX_PER_SECOND = 30;
const END_PAUSE_MS = 1_000;

export function getFeedbackTextMotion(
  scrollWidth: number,
  clientWidth: number,
): { distancePx: number; durationMs: number } | null {
  const distancePx = Math.max(0, Math.ceil(scrollWidth - clientWidth));
  if (distancePx === 0) return null;
  const travelMs = (distancePx / SCROLL_PX_PER_SECOND / 0.7) * 1_000;
  return { distancePx, durationMs: Math.round(travelMs + END_PAUSE_MS * 2) };
}
