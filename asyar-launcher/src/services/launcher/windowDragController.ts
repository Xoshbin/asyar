import { windowDragStart, windowDragMove, windowDragEnd } from '../../lib/ipc/commands';

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * The launcher's drag handle is its search header, which is also the
 * click-to-focus target for the search input; sticky notes' handle sits beside
 * their buttons. Without a threshold, the sub-pixel movement in an ordinary
 * click would nudge the window and swallow the click.
 */
export const DRAG_THRESHOLD_PX = 4;

/** A pointerdown inside any of these is the control's, not the window's. */
const NON_DRAG_SELECTORS = [
  'input',
  'textarea',
  'button',
  'a',
  'select',
  '[role="button"]',
  '[contenteditable="true"]',
  '[data-no-window-drag]',
];

export interface WindowDragController {
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(): void;
  /** True between the threshold being crossed and pointerup. */
  isDragging(): boolean;
}

/**
 * Turns pointer events on a drag handle into `window_drag_*` calls for the
 * window with the given Tauri label.
 *
 * Screen coordinates, not client ones: the window moves out from under the
 * cursor mid-drag, so client deltas would feed back on themselves. Moves are
 * coalesced to one IPC call per animation frame — a drag emits hundreds of
 * pointermove events and each call crosses the process boundary.
 *
 * Extracted from the component so it can be tested directly; the Svelte side
 * only forwards events.
 */
export function createWindowDragController(label: string): WindowDragController {
  let origin: { x: number; y: number } | null = null;
  let dragging = false;
  let pending: { dx: number; dy: number } | null = null;
  let frame = 0;

  function startsOnAControl(target: EventTarget | null): boolean {
    const el = target as { closest?: (s: string) => unknown } | null;
    if (!el?.closest) return false;
    return NON_DRAG_SELECTORS.some((selector) => el.closest!(selector) != null);
  }

  function flush() {
    frame = 0;
    if (!dragging || !pending) return;
    void windowDragMove(label, pending.dx, pending.dy);
    pending = null;
  }

  return {
    onPointerDown(e) {
      if (e.button !== 0 || startsOnAControl(e.target)) return;
      origin = { x: e.screenX, y: e.screenY };
    },

    onPointerMove(e) {
      if (!origin) return;
      const dx = e.screenX - origin.x;
      const dy = e.screenY - origin.y;

      if (!dragging) {
        if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
        dragging = true;
        // The anchor is captured Rust-side now, but the deltas stay measured
        // from the original pointerdown so the window does not jump by the
        // threshold distance on the first frame.
        void windowDragStart(label);
      }

      pending = { dx, dy };
      if (frame) return;
      frame = requestAnimationFrame(flush);
    },

    onPointerUp() {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
      pending = null;
      origin = null;
      if (!dragging) return;
      dragging = false;
      void windowDragEnd(label);
    },

    isDragging: () => dragging,
  };
}
