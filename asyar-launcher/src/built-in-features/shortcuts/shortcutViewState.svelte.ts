import { shortcutStore, groupShortcutsBySection, type ItemShortcut } from './shortcutStore.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { useListSelection } from '../../lib/listSelection.svelte';

class ShortcutViewStateClass {
  private selection = useListSelection<ItemShortcut>({ items: () => this.orderedItems });

  get groups(): { applications: ItemShortcut[]; commands: ItemShortcut[] } {
    const all = shortcutStore.shortcuts;
    const q = searchStores.query.trim().toLowerCase();
    const filtered = !q
      ? all
      : all.filter(
          (s) =>
            s.itemName.toLowerCase().includes(q) ||
            s.itemType.toLowerCase().includes(q) ||
            (s.itemPath?.toLowerCase().includes(q) ?? false),
        );
    return groupShortcutsBySection(filtered);
  }

  get orderedItems(): ItemShortcut[] {
    const { applications, commands } = this.groups;
    return [...applications, ...commands];
  }

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  get selectedShortcut(): ItemShortcut | null {
    return this.selection.selectedItem;
  }

  setIndex(index: number) {
    this.selection.setIndex(index);
  }

  moveSelection(direction: 'up' | 'down') {
    this.selection.moveSelection(direction);
  }

  reset() {
    this.selection.setIndex(0);
  }
}

export const shortcutViewState = new ShortcutViewStateClass();
