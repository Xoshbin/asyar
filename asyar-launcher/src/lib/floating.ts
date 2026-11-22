/**
 * Shows a dropdown in the browser's top layer, anchored to its trigger, so no
 * scrolling or clipping ancestor (a settings card, an onboarding step) can cut
 * it off. The node keeps its place in the DOM, so click-outside and focus
 * handling in the owning component keep working unchanged.
 */

const GAP_PX = 4;

export interface FloatingOptions {
  anchor: HTMLElement | null | undefined;
  /** Open upwards from the anchor instead of below it. */
  above?: boolean;
  /** `start` (default) spans the anchor's width; `end` keeps the menu's own width, right-aligned. */
  align?: 'start' | 'end';
}

export interface FloatingPlacement {
  left: number | null;
  right: number | null;
  width: number | null;
  top: number | null;
  bottom: number | null;
}

export function placeFloating(
  anchor: Pick<DOMRect, 'left' | 'right' | 'width' | 'top' | 'bottom'>,
  viewport: { width: number; height: number },
  { above = false, align = 'start' }: Pick<FloatingOptions, 'above' | 'align'> = {},
): FloatingPlacement {
  const vertical = above
    ? { top: null, bottom: viewport.height - anchor.top + GAP_PX }
    : { top: anchor.bottom + GAP_PX, bottom: null };
  const horizontal =
    align === 'end'
      ? { left: null, right: viewport.width - anchor.right, width: null }
      : { left: anchor.left, right: null, width: anchor.width };
  return { ...horizontal, ...vertical };
}

const px = (v: number | null) => (v === null ? 'auto' : `${v}px`);

export function floating(node: HTMLElement, options: FloatingOptions) {
  let current = options;

  function place() {
    if (!current.anchor) return;
    const p = placeFloating(
      current.anchor.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      current,
    );
    Object.assign(node.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      left: px(p.left),
      right: px(p.right),
      width: p.width === null ? '' : `${p.width}px`,
      top: px(p.top),
      bottom: px(p.bottom),
    });
  }

  if (typeof node.showPopover === 'function') {
    node.setAttribute('popover', 'manual');
    node.showPopover();
  }
  place();
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);

  return {
    update(next: FloatingOptions) {
      current = next;
      place();
    },
    destroy() {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    },
  };
}
