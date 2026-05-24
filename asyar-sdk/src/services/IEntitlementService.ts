/**
 * Interface for the entitlement service, available to Tier 2 extensions
 * via the EntitlementServiceProxy.
 *
 * Entitlements are string-based feature flags granted by the user's subscription.
 * Examples: "sync:settings", "ai:chat", "extensions:premium"
 *
 * Free-tier behavior: if the user is not logged in, check() returns true
 * for all entitlements (free features are unrestricted).
 */
export interface IEntitlementService {
  /**
   * Check if the current user has a specific entitlement.
   * Returns true if the user has the entitlement OR is not logged in.
   */
  check(entitlement: string): Promise<boolean>;

  /**
   * Returns the full list of active entitlements for the current user.
   * Returns an empty array if the user is not logged in.
   */
  getAll(): Promise<string[]>;
}
