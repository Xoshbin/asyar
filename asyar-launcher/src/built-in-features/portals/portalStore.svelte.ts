import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Portal {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

const DEFAULT_PORTALS: Omit<Portal, 'createdAt'>[] = [
  { id: 'default-search-google',    name: 'Search Google',    url: 'https://google.com/search?q={query}',   icon: '🌐' },
  { id: 'default-search-github',    name: 'Search GitHub',    url: 'https://github.com/search?q={query}',   icon: '🐙' },
  { id: 'default-search-wikipedia', name: 'Search Wikipedia', url: 'https://en.wikipedia.org/wiki/{query}', icon: '📖' },
];

function seedDefaults(): Portal[] {
  return DEFAULT_PORTALS.map(p => ({ ...p, createdAt: Date.now() }));
}

const persistence = createPersistence<Portal[]>('asyar:portals', 'portals.dat');

class PortalStoreClass {
  portals = $state<Portal[]>([]);
  #initialized = false;

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
      const deduped = data.filter(p => seen.has(p.id) ? false : (seen.add(p.id), true));
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
    return this.portals.find(p => p.id === id);
  }

  add(portal: Portal) {
    this.portals = [...this.portals, portal];
    persistence.save($state.snapshot(this.portals) as Portal[]);
  }

  update(id: string, changes: Partial<Portal>) {
    this.portals = this.portals.map(p => p.id === id ? { ...p, ...changes } : p);
    persistence.save($state.snapshot(this.portals) as Portal[]);
  }

  remove(id: string) {
    this.portals = this.portals.filter(p => p.id !== id);
    persistence.save($state.snapshot(this.portals) as Portal[]);
  }

  async reload() {
    this.#initialized = false;
    await this.init();
  }
}

export const portalStore = new PortalStoreClass();
