import { authService } from './authService.svelte';

class EntitlementService {
  /**
   * Check if the current user has a specific entitlement.
   *
   * Returns `true` in two cases:
   * 1. The user is NOT logged in — free tier has no restrictions.
   * 2. The user IS logged in AND the entitlement is in their list.
   *
   * Returns `false` only when the user is logged in but lacks the entitlement.
   */
  check(entitlement: string): boolean {
    if (!authService.isLoggedIn) return true; // free tier: unrestricted
    return authService.entitlements.includes(entitlement);
  }

  /**
   * Returns structured result for UI gating with an optional reason string.
   */
  gate(entitlement: string): { allowed: boolean; reason?: string } {
    if (!authService.isLoggedIn) return { allowed: true };
    if (authService.entitlements.includes(entitlement)) return { allowed: true };
    return {
      allowed: false,
      reason: `This feature requires a subscription. Sign in and upgrade to unlock it.`,
    };
  }

  /**
   * Returns all active entitlements. Used by the extension SDK proxy.
   */
  getAll(): string[] {
    return authService.entitlements;
  }
}

export const entitlementService = new EntitlementService();
