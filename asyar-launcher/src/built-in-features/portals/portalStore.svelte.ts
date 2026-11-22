import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Portal {
  id: string;
  name: string;
  url: string;
  icon: string;
  openWith?: string;
  tags?: string[];
  pinned?: boolean;
  hiddenInRootSearch?: boolean;
  createdAt: number;
  updatedAt?: number;
  openCount?: number;
}

const DEFAULT_PORTALS: Omit<Portal, 'createdAt'>[] = [
  {
    id: 'default-search-google',
    name: 'Search Google',
    url: 'https://google.com/search?q={query}',
    icon: '🌐',
  },
  {
    id: 'default-search-github',
    name: 'Search GitHub',
    url: 'https://github.com/search?q={query}',
    icon: '🐙',
  },
  {
    id: 'default-search-wikipedia',
    name: 'Search Wikipedia',
    url: 'https://en.wikipedia.org/wiki/{query}',
    icon: '📖',
  },
];

function seedDefaults(): Portal[] {
  return DEFAULT_PORTALS.map((p) => ({ ...p, createdAt: Date.now() }));
}

const persistence = createPersistence<Portal[]>('asyar:portals', 'portals.dat');

/**
 * Local change event emitted by the store on add/update/remove. Used by
 * the cloud sync delta provider to mark items dirty for the next push.
 */
export type PortalStoreChangeEvent =
  { type: 'upsert'; itemId: string } | { type: 'delete'; itemId: string };

class PortalStoreClass {
  portals = $state<Portal[]>([]);
  #initialized = false;
  #subscribers = new Set<(event: PortalStoreChangeEvent) => void>();

  subscribe(callback: (event: PortalStoreChangeEvent) => void): () => void {
    this.#subscribers.add(callback);
    return () => {
      this.#subscribers.delete(callback);
    };
  }

  #notify(event: PortalStoreChangeEvent): void {
    this.#subscribers.forEach((cb) => {
      try {
        cb(event);
      } catch {
        // Subscriber threw — swallow so other subscribers still see the event.
        // The portal store does not import logService to keep the constructor
        // (which runs at module load) lean and side-effect-free.
      }
    });
  }

  constructor() {
    const syncData = persistence.loadSync([]);
    this.portals = syncData.length > 0 ? syncData : seedDefaults();
  }

  async init() {
    if (this.#initialized) return;
    this.#initialized = true;
    let data = await persistence.load([]);
    if (data.length === 0) {
      data = seedDefaults();
      await persistence.save(data);
    } else {
      // Deduplicate by id — heals snapshots that accumulated duplicate defaults
      const seen = new Set<string>();
      const deduped = data.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
      if (deduped.length !== data.length) {
        data = deduped;
        await persistence.save(data);
      }
    }
    this.portals = data;
  }

  getAll(): Portal[] {
    return this.portals;
  }

  getById(id: string): Portal | undefined {
    return this.portals.find((p) => p.id === id);
  }

  add(portal: Portal) {
    // Upsert by id, NOT plain append. The cloud sync provider's
    // `applyItemUpsert` calls this with a portal that may already exist
    // locally (e.g., the same default portal seeded on two devices).
    // Plain append duplicates the entry, breaking Svelte's keyed-each
    // (which throws on duplicate keys → blacked-out portals view) and
    // leaving the local store in a state the user can't easily clean up.
    // Filter out any existing entry with the same id, then append the new
    // version — same semantics as the snippet store's `add`.
    this.portals = [...this.portals.filter((p) => p.id !== portal.id), portal];
    persistence.save($state.snapshot(this.portals) as Portal[]);
    this.#notify({ type: 'upsert', itemId: portal.id });
  }

  update(id: string, changes: Partial<Portal>) {
    this.portals = this.portals.map((p) =>
      p.id === id ? { ...p, ...changes, updatedAt: changes.updatedAt ?? Date.now() } : p,
    );
    persistence.save($state.snapshot(this.portals) as Portal[]);
    this.#notify({ type: 'upsert', itemId: id });
  }

  togglePin(id: string) {
    this.portals = this.portals.map((p) =>
      p.id === id ? { ...p, pinned: !p.pinned, updatedAt: Date.now() } : p,
    );
    persistence.save($state.snapshot(this.portals) as Portal[]);
    this.#notify({ type: 'upsert', itemId: id });
  }

  toggleHiddenInRootSearch(id: string) {
    this.portals = this.portals.map((p) =>
      p.id === id ? { ...p, hiddenInRootSearch: !p.hiddenInRootSearch, updatedAt: Date.now() } : p,
    );
    persistence.save($state.snapshot(this.portals) as Portal[]);
    this.#notify({ type: 'upsert', itemId: id });
  }

  recordOpen(id: string) {
    this.portals = this.portals.map((p) =>
      p.id === id ? { ...p, openCount: (p.openCount ?? 0) + 1 } : p,
    );
    persistence.save($state.snapshot(this.portals) as Portal[]);
  }

  getAllTags(): string[] {
    const tags = new Set<string>();
    for (const p of this.portals) {
      if (p.tags) {
        for (const tag of p.tags) {
          const trimmed = tag.trim();
          if (trimmed) tags.add(trimmed);
        }
      }
    }
    return [...tags].sort((a, b) => a.localeCompare(b));
  }

  importPortals(
    items: Array<{
      name: string;
      url: string;
      icon?: string;
      openWith?: string;
      tags?: string[];
    }>,
  ): { added: Portal[]; skipped: number } {
    const existingKeys = new Set(
      this.portals.map((p) => `${p.name.trim().toLowerCase()}\0${p.url.trim()}`),
    );
    const added: Portal[] = [];
    let skipped = 0;

    for (const item of items) {
      const name = item.name?.trim();
      const url = item.url?.trim();
      if (!name || !url) {
        skipped += 1;
        continue;
      }
      const key = `${name.toLowerCase()}\0${url}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      const portal: Portal = {
        id: crypto.randomUUID(),
        name,
        url,
        icon: item.icon?.trim() || '🔗',
        openWith: item.openWith?.trim() || undefined,
        tags: item.tags?.map((t) => t.trim()).filter(Boolean),
        createdAt: Date.now(),
      };
      added.push(portal);
    }

    if (added.length > 0) {
      this.portals = [...this.portals, ...added];
      persistence.save($state.snapshot(this.portals) as Portal[]);
      for (const p of added) {
        this.#notify({ type: 'upsert', itemId: p.id });
      }
    }

    return { added, skipped };
  }

  remove(id: string) {
    this.portals = this.portals.filter((p) => p.id !== id);
    persistence.save($state.snapshot(this.portals) as Portal[]);
    this.#notify({ type: 'delete', itemId: id });
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const portalStore = new PortalStoreClass();
