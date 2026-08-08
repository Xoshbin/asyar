import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/ipc/commands', () => ({
  windowDragStart: vi.fn().mockResolvedValue(undefined),
  windowDragMove: vi.fn().mockResolvedValue(undefined),
  windowDragEnd: vi.fn().mockResolvedValue(undefined),
}));

import { createWindowDragController, DRAG_THRESHOLD_PX } from './windowDragController';
import { windowDragStart, windowDragMove, windowDragEnd } from '../../lib/ipc/commands';

/** Minimal PointerEvent stand-in — jsdom's lacks screenX/screenY plumbing. */
function pointer(
  screenX: number,
  screenY: number,
  opts: { button?: number; target?: EventTarget | null } = {},
) {
  return {
    button: opts.button ?? 0,
    screenX,
    screenY,
    target: opts.target ?? null,
  } as unknown as PointerEvent;
}

/** A pointerdown target that reports itself as `selector`, like a real
 *  Element would through `closest()`. */
function elementMatching(selector: string | null): EventTarget {
  return { closest: (s: string) => (s === selector ? {} : null) } as unknown as EventTarget;
}

describe('windowDragController', () => {
  let frames: Array<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function flushFrame() {
    const pending = frames;
    frames = [];
    pending.forEach((cb) => cb());
  }

  it('does not start a drag before the pointer clears the threshold', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(100, 100));
    c.onPointerMove(pointer(100 + DRAG_THRESHOLD_PX - 1, 100));
    flushFrame();

    expect(windowDragStart).not.toHaveBeenCalled();
    expect(windowDragMove).not.toHaveBeenCalled();
  });

  it('keeps a plain click free of any drag IPC', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(100, 100));
    c.onPointerMove(pointer(101, 100));
    c.onPointerUp();
    flushFrame();

    expect(windowDragStart).not.toHaveBeenCalled();
    expect(windowDragEnd).not.toHaveBeenCalled();
    expect(c.isDragging()).toBe(false);
  });

  it('starts the drag once the threshold is crossed', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(100, 100));
    c.onPointerMove(pointer(100 + DRAG_THRESHOLD_PX + 1, 100));
    flushFrame();

    expect(windowDragStart).toHaveBeenCalledWith('main');
    expect(c.isDragging()).toBe(true);
  });

  it('sends deltas measured from the original pointerdown, not from the threshold', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(100, 100));
    c.onPointerMove(pointer(150, 130));
    flushFrame();

    expect(windowDragMove).toHaveBeenCalledWith('main', 50, 30);
  });

  it('coalesces a burst of moves into one call per frame', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(0, 0));
    for (let x = 10; x <= 40; x += 10) c.onPointerMove(pointer(x, 0));
    flushFrame();

    expect(windowDragMove).toHaveBeenCalledTimes(1);
    expect(windowDragMove).toHaveBeenCalledWith('main', 40, 0);
  });

  it('ends the drag and reports it finished', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(0, 0));
    c.onPointerMove(pointer(100, 0));
    flushFrame();
    c.onPointerUp();

    expect(windowDragEnd).toHaveBeenCalledWith('main');
    expect(c.isDragging()).toBe(false);
  });

  it('drops a queued frame that lands after pointerup', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(0, 0));
    c.onPointerMove(pointer(100, 0));
    c.onPointerUp();
    flushFrame();

    expect(windowDragMove).not.toHaveBeenCalled();
  });

  it.each(['input', 'button', 'a', '[role="button"]', '[data-no-window-drag]'])(
    'ignores a pointerdown that started on %s',
    (selector) => {
      const c = createWindowDragController('main');
      c.onPointerDown(pointer(0, 0, { target: elementMatching(selector) }));
      c.onPointerMove(pointer(200, 200));
      flushFrame();

      expect(windowDragStart).not.toHaveBeenCalled();
    },
  );

  it('ignores a non-primary button', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(0, 0, { button: 2 }));
    c.onPointerMove(pointer(200, 200));
    flushFrame();

    expect(windowDragStart).not.toHaveBeenCalled();
  });

  it('addresses whichever window label it was created for', () => {
    const c = createWindowDragController('sticky-abc');
    c.onPointerDown(pointer(0, 0));
    c.onPointerMove(pointer(100, 0));
    flushFrame();
    c.onPointerUp();

    expect(windowDragStart).toHaveBeenCalledWith('sticky-abc');
    expect(windowDragMove).toHaveBeenCalledWith('sticky-abc', 100, 0);
    expect(windowDragEnd).toHaveBeenCalledWith('sticky-abc');
  });

  it('starts a second drag cleanly after the first one ended', () => {
    const c = createWindowDragController('main');
    c.onPointerDown(pointer(0, 0));
    c.onPointerMove(pointer(100, 0));
    flushFrame();
    c.onPointerUp();

    c.onPointerDown(pointer(500, 500));
    c.onPointerMove(pointer(560, 500));
    flushFrame();

    expect(windowDragStart).toHaveBeenCalledTimes(2);
    expect(windowDragMove).toHaveBeenLastCalledWith('main', 60, 0);
  });
});
