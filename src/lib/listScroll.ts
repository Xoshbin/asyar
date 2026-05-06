/** Scroll a row into view inside a list container. At the first/last
 * index the container scrolls fully to its edge so padding and section
 * headers stay visible; otherwise the row is nudged just enough to keep
 * an 8px gap from the viewport edge. Shared by the main results list,
 * SplitListDetail, and ActionListPopup. */
export function scrollSelectedIntoView(listContainer: HTMLElement, selectedIndex: number): void {
  if (selectedIndex < 0) return;
  const selectedElement = listContainer.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
  if (!selectedElement) return;

  const isFirst = selectedIndex === 0;
  const lastIndex = Math.max(
    ...Array.from(listContainer.querySelectorAll<HTMLElement>('[data-index]'))
      .map((el) => Number(el.getAttribute('data-index')) || 0),
  );
  const isLast = selectedIndex === lastIndex;

  let scroller: HTMLElement | null = selectedElement;
  while (scroller && getComputedStyle(scroller).overflowY !== 'auto' && getComputedStyle(scroller).overflowY !== 'scroll') {
    scroller = scroller.parentElement;
  }
  if (!scroller) {
    selectedElement.scrollIntoView({ block: 'nearest' });
    return;
  }

  if (isFirst) {
    scroller.scrollTop = 0;
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
