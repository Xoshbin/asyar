import { portalStore } from '../../../built-in-features/portals/portalStore.svelte'

const SAMPLE_NAME = 'Search GitHub'

export function seedSamplePortal(): void {
  if (portalStore.portals.some((p) => p.name === SAMPLE_NAME)) return
  portalStore.add({
    id: crypto.randomUUID(),
    name: SAMPLE_NAME,
    url: 'https://github.com/search?q={query}',
    icon: '🌐',
    createdAt: Date.now(),
  })
}
