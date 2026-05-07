import { describe, it, expect } from 'vitest';
import { useListSelection, shiftIndex } from './listSelection.svelte';

describe('shiftIndex', () => {
  it('wraps from last to first when moving down', () => {
    expect(shiftIndex(2, 3, 'down')).toBe(0);
  });

  it('wraps from first to last when moving up', () => {
    expect(shiftIndex(0, 3, 'up')).toBe(2);
  });

  it('clamps without wrap at the bottom edge', () => {
    expect(shiftIndex(2, 3, 'down', false)).toBe(2);
  });

  it('clamps without wrap at the top edge', () => {
    expect(shiftIndex(0, 3, 'up', false)).toBe(0);
  });

  it('returns -1 for an empty list', () => {
    expect(shiftIndex(0, 0, 'down')).toBe(-1);
    expect(shiftIndex(-1, 0, 'up')).toBe(-1);
  });

  it('treats a -1 starting index as 0', () => {
    expect(shiftIndex(-1, 3, 'down')).toBe(1);
  });
});

// $derived/$state need an effect root to run outside a component. Each test
// runs inside one and tears it down at the end.
function withRoot(fn: () => void) {
  const dispose = $effect.root(fn);
  dispose();
}

describe('useListSelection', () => {
  it('starts at index 0 when items exist', () => {
    withRoot(() => {
      const items = ['a', 'b', 'c'];
      const sel = useListSelection({ items: () => items });
      expect(sel.selectedIndex).toBe(0);
      expect(sel.selectedItem).toBe('a');
    });
  });

  it('reports -1 and null when items are empty', () => {
    withRoot(() => {
      const sel = useListSelection<string>({ items: () => [] });
      expect(sel.selectedIndex).toBe(-1);
      expect(sel.selectedItem).toBeNull();
    });
  });

  it('clamps to 0 when the list shrinks past the current index', () => {
    withRoot(() => {
      let items = $state(['a', 'b', 'c', 'd']);
      const sel = useListSelection({ items: () => items });
      sel.setIndex(3);
      expect(sel.selectedIndex).toBe(3);
      items = ['x', 'y'];
      expect(sel.selectedIndex).toBe(0);
      expect(sel.selectedItem).toBe('x');
    });
  });

  it('drops to -1 when items become empty, restores to 0 when refilled', () => {
    withRoot(() => {
      let items = $state(['a', 'b']);
      const sel = useListSelection({ items: () => items });
      sel.setIndex(1);
      items = [];
      expect(sel.selectedIndex).toBe(-1);
      expect(sel.selectedItem).toBeNull();
      items = ['p', 'q', 'r'];
      expect(sel.selectedIndex).toBe(0);
      expect(sel.selectedItem).toBe('p');
    });
  });

  it('preserves the chosen index when items reshuffle within range', () => {
    withRoot(() => {
      let items = $state(['a', 'b', 'c']);
      const sel = useListSelection({ items: () => items });
      sel.setIndex(2);
      items = ['x', 'y', 'z'];
      expect(sel.selectedIndex).toBe(2);
      expect(sel.selectedItem).toBe('z');
    });
  });

  it('moveSelection wraps at the bottom edge', () => {
    withRoot(() => {
      const items = ['a', 'b', 'c'];
      const sel = useListSelection({ items: () => items });
      sel.setIndex(2);
      sel.moveSelection('down');
      expect(sel.selectedIndex).toBe(0);
    });
  });

  it('moveSelection wraps at the top edge', () => {
    withRoot(() => {
      const items = ['a', 'b', 'c'];
      const sel = useListSelection({ items: () => items });
      sel.setIndex(0);
      sel.moveSelection('up');
      expect(sel.selectedIndex).toBe(2);
    });
  });

  it('moveSelection clamps when wrap=false', () => {
    withRoot(() => {
      const items = ['a', 'b', 'c'];
      const sel = useListSelection({ items: () => items, wrap: false });
      sel.setIndex(0);
      sel.moveSelection('up');
      expect(sel.selectedIndex).toBe(0);
      sel.setIndex(2);
      sel.moveSelection('down');
      expect(sel.selectedIndex).toBe(2);
    });
  });

  it('moveSelection is a no-op on an empty list', () => {
    withRoot(() => {
      const sel = useListSelection<string>({ items: () => [] });
      sel.moveSelection('down');
      sel.moveSelection('up');
      expect(sel.selectedIndex).toBe(-1);
    });
  });

  it('setIndex out of range is ignored', () => {
    withRoot(() => {
      const items = ['a', 'b', 'c'];
      const sel = useListSelection({ items: () => items });
      sel.setIndex(99);
      expect(sel.selectedIndex).toBe(0);
      sel.setIndex(-5);
      expect(sel.selectedIndex).toBe(0);
    });
  });
});
