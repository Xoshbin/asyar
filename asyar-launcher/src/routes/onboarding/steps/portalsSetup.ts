import { portalStore } from '../../../built-in-features/portals/portalStore.svelte';
import { t } from '../../../services/i18n';

// Identified by URL, not the localized name, so switching language can't add a duplicate.
// Must not be one of portalStore's DEFAULT_PORTALS, or the sample counts as added before it is.
const SAMPLE_PORTAL_URL = 'https://www.youtube.com/results?search_query={query}';

export function samplePortalName(): string {
  return t('onboarding.sample_portal_name');
}

export function hasSamplePortal(): boolean {
  return portalStore.portals.some((p) => p.url === SAMPLE_PORTAL_URL);
}

export function seedSamplePortal(): void {
  if (hasSamplePortal()) return;
  portalStore.add({
    id: crypto.randomUUID(),
    name: samplePortalName(),
    url: SAMPLE_PORTAL_URL,
    icon: '📺',
    createdAt: Date.now(),
  });
}
