import { portalStore } from '../../../built-in-features/portals/portalStore.svelte';

// Must not be one of portalStore's DEFAULT_PORTALS, or the sample counts as added before it is.
export const SAMPLE_PORTAL_NAME = 'Search YouTube';

export function hasSamplePortal(): boolean {
  return portalStore.portals.some((p) => p.name === SAMPLE_PORTAL_NAME);
}

export function seedSamplePortal(): void {
  if (hasSamplePortal()) return;
  portalStore.add({
    id: crypto.randomUUID(),
    name: SAMPLE_PORTAL_NAME,
    url: 'https://www.youtube.com/results?search_query={query}',
    icon: '📺',
    createdAt: Date.now(),
  });
}
