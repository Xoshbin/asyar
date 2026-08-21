import { logService } from '../../services/log/logService';
import type { IStorageService } from 'asyar-sdk/contracts';
import type { WindowBounds } from '../../lib/ipc/commands';
import { useListSelection } from '../../lib/listSelection.svelte';

export interface CustomLayout {
  id: string;
  name: string;
  bounds: WindowBounds;
}

const STORAGE_KEY_LAYOUTS = 'custom_layouts';
const STORAGE_KEY_PREV_BOUNDS = 'previous_bounds';

export class WindowManagementState {
  customLayouts = $state<CustomLayout[]>([]);
  previousBounds = $state<WindowBounds | null>(null);
  store = $state<IStorageService | null>(null);

  private selection = useListSelection({ items: () => this.customLayouts });

  get selectedIndex(): number {
    return this.selection.selectedIndex;
  }

  get selectedLayout(): CustomLayout | null {
    return this.selection.selectedItem;
  }

  setStore(store: IStorageService): void {
    this.store = store;
  }

  setIndex(index: number): void {
    this.selection.setIndex(index);
  }

  moveSelection(direction: 'up' | 'down'): void {
    this.selection.moveSelection(direction);
  }

  async loadFromStorage(store?: IStorageService): Promise<void> {
    const targetStore = store ?? this.store;
    if (!targetStore) return;
    try {
      const rawLayouts = await targetStore.get(STORAGE_KEY_LAYOUTS);
      this.customLayouts = rawLayouts ? JSON.parse(rawLayouts) : [];
    } catch {
      logService.warn('[WindowManagement] Failed to parse custom_layouts — resetting to []');
      this.customLayouts = [];
    }

    try {
      const rawBounds = await targetStore.get(STORAGE_KEY_PREV_BOUNDS);
      this.previousBounds = rawBounds ? JSON.parse(rawBounds) : null;
    } catch {
      this.previousBounds = null;
    }
  }

  async addCustomLayout(
    name: string,
    bounds: WindowBounds,
    store?: IStorageService,
  ): Promise<CustomLayout> {
    const targetStore = store ?? this.store;
    const layout: CustomLayout = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      bounds,
    };
    this.customLayouts = [...this.customLayouts, layout];
    if (targetStore) {
      await targetStore.set(STORAGE_KEY_LAYOUTS, JSON.stringify(this.customLayouts));
    }
    this.selection.setIndex(this.customLayouts.length - 1);
    return layout;
  }

  async deleteCustomLayout(id: string, store?: IStorageService): Promise<void> {
    const targetStore = store ?? this.store;
    this.customLayouts = this.customLayouts.filter((l) => l.id !== id);
    if (targetStore) {
      await targetStore.set(STORAGE_KEY_LAYOUTS, JSON.stringify(this.customLayouts));
    }
  }

  async renameCustomLayout(id: string, newName: string, store?: IStorageService): Promise<void> {
    const targetStore = store ?? this.store;
    const trimmed = newName.trim();
    if (!trimmed) return;
    const existing = this.customLayouts.find((l) => l.id === id);
    if (!existing || existing.name === trimmed) return;

    this.customLayouts = this.customLayouts.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
    if (targetStore) {
      await targetStore.set(STORAGE_KEY_LAYOUTS, JSON.stringify(this.customLayouts));
    }
  }

  async savePreviousBounds(bounds: WindowBounds, store?: IStorageService): Promise<void> {
    const targetStore = store ?? this.store;
    this.previousBounds = bounds;
    if (targetStore) {
      await targetStore.set(STORAGE_KEY_PREV_BOUNDS, JSON.stringify(bounds));
    }
  }
}

export const windowManagementState = new WindowManagementState();
