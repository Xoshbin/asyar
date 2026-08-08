/** Seeded portals ship with the app and carry this id prefix. */
const SEEDED_PORTAL_ID_PREFIX = 'default-';

/**
 * `portalStore` seeds defaults on first run, so a raw length would complete
 * the "save a portal" task before the user did anything.
 */
export function countUserCreatedPortals(portals: { id: string }[] | undefined): number {
  return (portals ?? []).filter((p) => !p.id?.startsWith(SEEDED_PORTAL_ID_PREFIX)).length;
}
