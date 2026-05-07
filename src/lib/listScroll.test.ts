/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { scrollSelectedIntoView } from './listScroll';

// jsdom skips layout, so we fake the reads the function performs
// (overflowY, scrollHeight, clientHeight, getBoundingClientRect). Writes to
// scrollTop are real properties jsdom honours.
function makeRow(index: number, top: number, height: number): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-index', String(index));
  row.getBoundingClientRect = () => ({
    top, height, bottom: top + height, left: 0, right: 0, width: 0,
    x: 0, y: top, toJSON: () => ({}),
  });
  return row;
}

function makeContainer(opts: {
  rows: HTMLElement[];
  scrollerOverflowY?: 'auto' | 'visible';
  scrollerTop?: number;
  scrollerClientHeight?: number;
  scrollerScrollHeight?: number;
  scrollerInitialScrollTop?: number;
}): HTMLElement {
  const container = document.createElement('div');
  for (const r of opts.rows) container.appendChild(r);
  Object.defineProperty(container, 'scrollHeight', {
    configurable: true,
    get: () => opts.scrollerScrollHeight ?? 0,
  });
  Object.defineProperty(container, 'clientHeight', {
    configurable: true,
    get: () => opts.scrollerClientHeight ?? 0,
  });
  container.scrollTop = opts.scrollerInitialScrollTop ?? 0;
  container.getBoundingClientRect = () => ({
    top: opts.scrollerTop ?? 0, height: opts.scrollerClientHeight ?? 0,
    bottom: (opts.scrollerTop ?? 0) + (opts.scrollerClientHeight ?? 0),
    left: 0, right: 0, width: 0, x: 0, y: opts.scrollerTop ?? 0,
    toJSON: () => ({}),
  });
  // The walk-up loop reads getComputedStyle(node).overflowY; stub it so the
  // container qualifies as the scroller.
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
    return ({ overflowY: el === container ? (opts.scrollerOverflowY ?? 'auto') : 'visible' } as unknown) as CSSStyleDeclaration;
  });
  document.body.appendChild(container);
  return container;
}

describe('scrollSelectedIntoView', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does nothing for a negative index', () => {
    const container = makeContainer({ rows: [makeRow(0, 0, 10)], scrollerInitialScrollTop: 42 });
    scrollSelectedIntoView(container, -1);
    expect(container.scrollTop).toBe(42);
  });

  it('does nothing when the row is not present', () => {
    const container = makeContainer({ rows: [makeRow(0, 0, 10)], scrollerInitialScrollTop: 42 });
    scrollSelectedIntoView(container, 99);
    expect(container.scrollTop).toBe(42);
  });

  it('snaps the scroller to the top for index 0', () => {
    const container = makeContainer({
      rows: [makeRow(0, 0, 30), makeRow(1, 30, 30)],
      scrollerInitialScrollTop: 200,
      scrollerScrollHeight: 600,
      scrollerClientHeight: 100,
    });
    scrollSelectedIntoView(container, 0);
    expect(container.scrollTop).toBe(0);
  });

  it('snaps the scroller to the bottom for the last index', () => {
    const container = makeContainer({
      rows: [makeRow(0, 0, 30), makeRow(1, 30, 30), makeRow(2, 60, 30)],
      scrollerInitialScrollTop: 0,
      scrollerScrollHeight: 600,
      scrollerClientHeight: 100,
    });
    scrollSelectedIntoView(container, 2);
    expect(container.scrollTop).toBe(600);
  });

  it('nudges scrollTop down when the row is below the viewport', () => {
    // Row 1 at offsetTop=200, height=30 → rowBottom=230. Viewport is 100px,
    // so minScroll = 230 + 8 - 100 = 138.
    const rows = [makeRow(0, 0, 30), makeRow(1, 200, 30), makeRow(2, 260, 30)];
    const container = makeContainer({
      rows,
      scrollerInitialScrollTop: 0,
      scrollerScrollHeight: 600,
      scrollerClientHeight: 100,
      scrollerTop: 0,
    });
    scrollSelectedIntoView(container, 1);
    expect(container.scrollTop).toBe(138);
  });

  it('pulls scrollTop up when the row is above the viewport', () => {
    // Row 1's rect top is -50 (already scrolled past). offsetTop = -50 + 300
    // = 250 → maxScroll = 250 - 8 = 242.
    const rows = [makeRow(0, -80, 30), makeRow(1, -50, 30), makeRow(2, -20, 30)];
    const container = makeContainer({
      rows,
      scrollerInitialScrollTop: 300,
      scrollerScrollHeight: 600,
      scrollerClientHeight: 100,
      scrollerTop: 0,
    });
    scrollSelectedIntoView(container, 1);
    expect(container.scrollTop).toBe(242);
  });

  it('leaves scrollTop alone when the row is already comfortably visible', () => {
    const rows = [makeRow(0, 0, 30), makeRow(1, 40, 30), makeRow(2, 80, 30)];
    const container = makeContainer({
      rows,
      scrollerInitialScrollTop: 50,
      scrollerScrollHeight: 600,
      scrollerClientHeight: 200,
      scrollerTop: 0,
    });
    scrollSelectedIntoView(container, 1);
    expect(container.scrollTop).toBe(50);
  });

  it('falls back to scrollIntoView when no scrollable ancestor exists', () => {
    const row0 = makeRow(0, 0, 30);
    const row1 = makeRow(1, 30, 30);
    const container = document.createElement('div');
    container.appendChild(row0);
    container.appendChild(row1);
    document.body.appendChild(container);
    // overflow:visible everywhere → walk-up finds no scroller → fallback fires.
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => (({ overflowY: 'visible' } as unknown) as CSSStyleDeclaration),
    );
    const spy = vi.fn();
    row1.scrollIntoView = spy;
    scrollSelectedIntoView(container, 1);
    expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
