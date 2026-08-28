/** Find the nearest scrollable ancestor of an element (or the element itself). */
export function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let scroller: HTMLElement | null = element;
  while (
    scroller &&
    getComputedStyle(scroller).overflowY !== 'auto' &&
    getComputedStyle(scroller).overflowY !== 'scroll'
  ) {
    scroller = scroller.parentElement;
  }
  return scroller;
}

/** Reset the scroll position of a list container's scrollable parent to top (0). */
export function resetListScroll(listContainer: HTMLElement): void {
  const scroller = findScrollContainer(listContainer);
  if (scroller) {
    scroller.scrollTop = 0;
  }
}

/** Scroll a row into view inside a list container. At the first/last index
 * the container snaps fully to its edge so padding and section headers stay
 * visible; otherwise the row is nudged just enough to keep an 8px gap from
 * the viewport edge. */
export function scrollSelectedIntoView(listContainer: HTMLElement, selectedIndex: number): void {
  if (selectedIndex < 0) return;

  const selectedElement = listContainer.querySelector<HTMLElement>(
    `[data-index="${selectedIndex}"]`,
  );

  const isFirst = selectedIndex === 0;
  const scroller = findScrollContainer(selectedElement ?? listContainer);

  if (isFirst && scroller) {
    scroller.scrollTop = 0;
    return;
  }

  if (!selectedElement) return;

  const lastIndex = Math.max(
    ...Array.from(listContainer.querySelectorAll<HTMLElement>('[data-index]')).map(
      (el) => Number(el.getAttribute('data-index')) || 0,
    ),
  );
  const isLast = selectedIndex === lastIndex;

  if (!scroller) {
    selectedElement.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (isLast) {
    scroller.scrollTop = scroller.scrollHeight;
    return;
  }

  const EDGE_GAP = 8;
  const rowRect = selectedElement.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const offsetTop = rowRect.top - scrollerRect.top + scroller.scrollTop;
  const rowBottom = offsetTop + rowRect.height;

  const minScroll = rowBottom + EDGE_GAP - scroller.clientHeight;
  const maxScroll = offsetTop - EDGE_GAP;

  if (scroller.scrollTop > maxScroll) {
    scroller.scrollTop = maxScroll;
  } else if (scroller.scrollTop < minScroll) {
    scroller.scrollTop = minScroll;
  }
}
