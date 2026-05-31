import { listCreatedExtensions, type CreatedExtension } from './createdExtensions';
import { useListSelection } from '../../../lib/listSelection.svelte';
import { diagnosticsService } from '../../../services/diagnostics/diagnosticsService.svelte';

class CreatedExtensionsViewState {
  items = $state<CreatedExtension[]>([]);
  searchQuery = $state('');

  private selection = useListSelection({ items: () => this.filtered() });

  async load(): Promise<void> {
    try {
      this.items = await listCreatedExtensions();
    } catch (err) {
      this.items = [];
      await diagnosticsService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: `Could not list created extensions: ${String(err)}` },
      });
    }
  }

  filtered(): CreatedExtension[] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.items;
    return this.items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q),
    );
  }

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  get selectedItem(): CreatedExtension | null {
    return this.selection.selectedItem;
  }

  setSearch(q: string): void {
    this.searchQuery = q;
    this.selection.setIndex(0);
  }

  moveSelection(dir: 'up' | 'down'): void {
    this.selection.moveSelection(dir);
  }

  reset(): void {
    this.items = [];
    this.searchQuery = '';
    this.selection.setIndex(0);
  }
}

export const createdExtensionsViewState = new CreatedExtensionsViewState();
