/** Shift an index by one slot, wrapping by default. Exposed for stores
 * that key selection by id (rather than by index) and just need the
 * arithmetic. */
export function shiftIndex(
  current: number,
  length: number,
  direction: 'up' | 'down',
  wrap = true,
): number {
  if (length === 0) return -1;
  const start = current < 0 ? 0 : current;
  if (direction === 'down') {
    const next = start + 1;
    return wrap ? next % length : Math.min(next, length - 1);
  }
  const next = start - 1;
  return wrap ? (next + length) % length : Math.max(next, 0);
}

export interface ListSelection<T> {
  readonly selectedIndex: number;
  readonly selectedItem: T | null;
  setIndex(index: number): void;
  moveSelection(direction: 'up' | 'down'): void;
}

export interface ListSelectionOptions<T> {
  items: () => readonly T[];
  wrap?: boolean;
}

/** Index-based selection that auto-picks the first item, clamps when the
 * list shrinks, drops to -1 when empty, and wraps on arrow moves. `items`
 * is a getter so the clamp re-runs whenever the source list changes. */
export function useListSelection<T>({
  items,
  wrap = true,
}: ListSelectionOptions<T>): ListSelection<T> {
  let raw = $state(0);

  const clamped = $derived.by(() => {
    const len = items().length;
    if (len === 0) return -1;
    if (raw < 0 || raw >= len) return 0;
    return raw;
  });

  return {
    get selectedIndex() {
      return clamped;
    },
    get selectedItem() {
      const list = items();
      return clamped >= 0 && clamped < list.length ? list[clamped] : null;
    },
    setIndex(next: number) {
      const len = items().length;
      if (len === 0) {
        raw = -1;
        return;
      }
      if (next < 0 || next >= len) return;
      raw = next;
    },
    moveSelection(direction: 'up' | 'down') {
      const len = items().length;
      if (len === 0) return;
      raw = shiftIndex(clamped, len, direction, wrap);
    },
  };
}
