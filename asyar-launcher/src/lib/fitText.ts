/**
 * Shrink-to-fit for single-line display text (calculator cards).
 *
 * `computeFitFontSize` / `computeSharedFitSize` are the pure math; the
 * `fitText` Svelte action measures the DOM and applies it, re-running on
 * content changes and container resizes. Members of one `createFitGroup()`
 * always render at the same final size (the smallest fit among them), so
 * side-by-side panels stay visually balanced. Below the floor a fade mask
 * takes over (see the `data-overflowing` flag).
 */

/** Fraction of the CSS-defined font size the text may shrink to. */
const MIN_RATIO = 0.38;

/**
 * scrollWidth/clientWidth are integer-rounded, so a size computed from
 * them can still overflow by a hair — and 1px of overflow is enough to
 * trigger truncation. Padding the measured width absorbs that.
 */
const SAFETY_PX = 2;

export interface FitMeasurement {
  maxFontPx: number;
  naturalWidthPx: number;
  availableWidthPx: number;
  minFontPx: number;
}

export function computeFitFontSize(
  maxFontPx: number,
  naturalWidthPx: number,
  availableWidthPx: number,
  minFontPx: number,
): number {
  if (maxFontPx <= 0 || naturalWidthPx <= 0 || availableWidthPx <= 0) {
    return maxFontPx;
  }
  if (naturalWidthPx <= availableWidthPx) {
    return maxFontPx;
  }
  const scaled = maxFontPx * (availableWidthPx / naturalWidthPx);
  return Math.max(minFontPx, Math.floor(scaled * 100) / 100);
}

/**
 * The single size a group of elements should share: the smallest
 * individual fit. Unmeasurable members (hidden, zero-width) are ignored.
 */
export function computeSharedFitSize(measurements: FitMeasurement[]): number {
  let shared = 0;
  for (const m of measurements) {
    if (m.maxFontPx <= 0) continue;
    const fit = computeFitFontSize(m.maxFontPx, m.naturalWidthPx, m.availableWidthPx, m.minFontPx);
    shared = shared === 0 ? fit : Math.min(shared, fit);
  }
  return shared;
}

export interface FitGroup {
  add(node: HTMLElement): void;
  remove(node: HTMLElement): void;
  refit(): void;
}

/**
 * Create a group whose members always share one font size. Use a group
 * per card so the Expression and Result panels shrink together.
 */
export function createFitGroup(): FitGroup {
  const members = new Set<HTMLElement>();
  let frame = 0;

  const refit = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const nodes = [...members];
      // Reset every member to its CSS (token) size first, then measure —
      // interleaving the two would thrash layout and skew measurements.
      for (const node of nodes) {
        node.style.fontSize = '';
      }
      const measured = nodes.map((node) => {
        const max = parseFloat(getComputedStyle(node).fontSize) || 0;
        return {
          maxFontPx: max,
          naturalWidthPx: node.scrollWidth + SAFETY_PX,
          availableWidthPx: node.clientWidth,
          minFontPx: max * MIN_RATIO,
        };
      });
      const shared = computeSharedFitSize(measured);
      if (shared <= 0) return;
      nodes.forEach((node, i) => {
        if (measured[i].maxFontPx > 0 && shared < measured[i].maxFontPx) {
          node.style.fontSize = `${shared}px`;
        }
      });
      // Even the floor size can overflow for extreme inputs; flag it so
      // CSS can fade the clipped edge instead of showing "…".
      for (const node of nodes) {
        node.dataset.overflowing = String(node.scrollWidth > node.clientWidth);
      }
    });
  };

  return {
    add(node) {
      members.add(node);
      refit();
    },
    remove(node) {
      members.delete(node);
      if (members.size > 0) refit();
      else cancelAnimationFrame(frame);
    },
    refit,
  };
}

export function fitText(node: HTMLElement, group?: FitGroup): { destroy(): void } {
  const g = group ?? createFitGroup();

  const mutations = new MutationObserver(g.refit);
  mutations.observe(node, { childList: true, characterData: true, subtree: true });

  let lastWidth = -1;
  const resizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width =
        entry.contentBoxSize && entry.contentBoxSize[0]
          ? entry.contentBoxSize[0].inlineSize
          : entry.contentRect.width;
      if (Math.abs(width - lastWidth) > 0.5) {
        lastWidth = width;
        g.refit();
      }
    }
  });

  const observedTarget = node.parentElement ?? node;
  resizes.observe(observedTarget);
  g.add(node);

  return {
    destroy() {
      mutations.disconnect();
      resizes.disconnect();
      g.remove(node);
    },
  };
}
