/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { computeFitFontSize, computeSharedFitSize } from './fitText';

describe('computeFitFontSize', () => {
  it('keeps the max size when the text already fits', () => {
    expect(computeFitFontSize(32, 200, 300, 14)).toBe(32);
    expect(computeFitFontSize(32, 300, 300, 14)).toBe(32);
  });

  it('scales the font down proportionally to the overflow', () => {
    // Text is twice as wide as the panel → half the font size.
    expect(computeFitFontSize(32, 600, 300, 14)).toBe(16);
    // 25% overflow → 80% of the size.
    expect(computeFitFontSize(30, 500, 400, 14)).toBe(24);
  });

  it('never goes below the minimum', () => {
    expect(computeFitFontSize(32, 4000, 300, 14)).toBe(14);
  });

  it('is defensive about degenerate measurements', () => {
    expect(computeFitFontSize(32, 0, 300, 14)).toBe(32);
    expect(computeFitFontSize(32, 600, 0, 14)).toBe(32);
    expect(computeFitFontSize(0, 600, 300, 14)).toBe(0);
  });
});

describe('computeSharedFitSize', () => {
  const m = (maxFontPx: number, naturalWidthPx: number, availableWidthPx: number) => ({
    maxFontPx,
    naturalWidthPx,
    availableWidthPx,
    minFontPx: maxFontPx * 0.4,
  });

  it('uses the smaller fit so both members render at the same size', () => {
    // Member A fits at full size; B needs half → both get half.
    expect(computeSharedFitSize([m(32, 200, 300), m(32, 600, 300)])).toBe(16);
  });

  it('keeps the full size when every member fits', () => {
    expect(computeSharedFitSize([m(32, 200, 300), m(32, 250, 300)])).toBe(32);
  });

  it('ignores unmeasurable members instead of poisoning the result', () => {
    expect(computeSharedFitSize([m(0, 0, 0), m(32, 600, 300)])).toBe(16);
    expect(computeSharedFitSize([m(32, 600, 0)])).toBe(32);
    expect(computeSharedFitSize([])).toBe(0);
  });
});

describe('fitText action', () => {
  it('observes the parent element for resize rather than the text node itself', async () => {
    const { fitText } = await import('./fitText');

    let observedTarget: any = null;
    class MockResizeObserver {
      observe(target: Element) {
        observedTarget = target;
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    class MockMutationObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('MutationObserver', MockMutationObserver);

    const parent = document.createElement('div');
    const textNode = document.createElement('span');
    parent.appendChild(textNode);

    const action = fitText(textNode);
    expect(observedTarget).toBe(parent);
    action.destroy();

    vi.unstubAllGlobals();
  });

  it('ignores height-only resize notifications to prevent font-size oscillation loops', async () => {
    const { fitText } = await import('./fitText');

    let resizeCallback: (entries: any[]) => void = () => {};
    class MockResizeObserver {
      constructor(cb: (entries: any[]) => void) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver);

    class MockMutationObserver {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('MutationObserver', MockMutationObserver);

    const mockGroup = {
      add: vi.fn(),
      remove: vi.fn(),
      refit: vi.fn(),
    };

    const parent = document.createElement('div');
    const textNode = document.createElement('span');
    parent.appendChild(textNode);

    const action = fitText(textNode, mockGroup as any);
    mockGroup.refit.mockClear();

    // First resize callback with width 200, height 40
    resizeCallback([{ contentRect: { width: 200, height: 40 } }]);
    expect(mockGroup.refit).toHaveBeenCalledTimes(1);
    mockGroup.refit.mockClear();

    // Second resize callback with same width 200, but height 15 (due to font shrink)
    resizeCallback([{ contentRect: { width: 200, height: 15 } }]);
    // Must NOT call refit because width did not change
    expect(mockGroup.refit).not.toHaveBeenCalled();

    // Third resize callback with changed width 250
    resizeCallback([{ contentRect: { width: 250, height: 15 } }]);
    expect(mockGroup.refit).toHaveBeenCalledTimes(1);

    action.destroy();
    vi.unstubAllGlobals();
  });
});
