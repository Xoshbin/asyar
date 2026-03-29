import { createPersistence } from '../../lib/persistence/extensionStore';

export interface Portal {
  id: string;
  name: string;
  url: string;
  icon: string;
  createdAt: number;
}

const DEFAULT_PORTALS: Omit<Portal, 'id' | 'createdAt'>[] = [
  { name: 'Search Google',    url: 'https://google.com/search?q={query}',  icon: '🌐' },
  { name: 'Search GitHub',    url: 'https://github.com/search?q={query}',  icon: '🐙' },
  { name: 'Search Wikipedia', url: 'https://en.wikipedia.org/wiki/{query}', icon: '📖' },
];

function seedDefaults(): Portal[] {
  return DEFAULT_PORTALS.map(p => ({
    ...p,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  }));
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
    persistence.save(this.portals);
  }

  update(id: string, changes: Partial<Portal>) {
    this.portals = this.portals.map(p => p.id === id ? { ...p, ...changes } : p);
    persistence.save(this.portals);
  }

  remove(id: string) {
    this.portals = this.portals.filter(p => p.id !== id);
    persistence.save(this.portals);
  }
}

export const portalStore = new PortalStoreClass();
