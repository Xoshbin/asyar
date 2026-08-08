/** Seeded portals ship with the app and carry this id prefix. */
const SEEDED_PORTAL_ID_PREFIX = 'default-';

/**
 * Count only portals the user made. `portalStore` seeds a handful of defaults
 * on first run, so a raw length would complete the "save a portal" task for
 * everyone before they had done anything.
 *
 * Lives in its own dependency-free file so the rule is testable without
 * pulling the store singletons into a node test.
 */
export function countUserCreatedPortals(portals: { id: string }[] | undefined): number {
  return (portals ?? []).filter((p) => !p.id?.startsWith(SEEDED_PORTAL_ID_PREFIX)).length;
}
