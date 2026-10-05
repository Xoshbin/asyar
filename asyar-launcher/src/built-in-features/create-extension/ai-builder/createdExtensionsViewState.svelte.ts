import { t } from '../../../services/i18n';
import {
  listCreatedExtensions,
  searchCreatedExtensions,
  type CreatedExtension,
} from './createdExtensions';
import { useListSelection } from '../../../lib/listSelection.svelte';
import { feedbackService } from '../../../services/feedback/feedbackService.svelte';

class CreatedExtensionsViewState {
  // The currently displayed list. Rust owns scanning and filtering; this always
  // holds whatever the latest list/search command returned.
  items = $state<CreatedExtension[]>([]);
  searchQuery = $state('');

  private selection = useListSelection({ items: () => this.items });

  async load(): Promise<void> {
    try {
      this.items = await listCreatedExtensions();
    } catch (err) {
      this.items = [];
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: {
          message: t('features.create_extension.view.list_failed', { error: String(err) }),
        },
      });
    }
  }

  filtered(): CreatedExtension[] {
    return this.items;
  }

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  get selectedItem(): CreatedExtension | null {
    return this.selection.selectedItem;
  }

  async setSearch(q: string): Promise<void> {
    this.searchQuery = q;
    try {
      this.items = await searchCreatedExtensions(q);
    } catch (err) {
      this.items = [];
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: {
          message: t('features.create_extension.view.search_failed', { error: String(err) }),
        },
      });
    }
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
