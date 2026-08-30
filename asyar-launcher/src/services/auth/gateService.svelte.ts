import { authService } from './authService.svelte';
import { settingsService } from '../settings/settingsService.svelte';
import type { Ability } from '../../lib/ipc/commands';

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

export type AbilityName =
  | Ability
  | 'sync.egress'
  | 'ai.cloud-models'
  | 'sync.ai-conversations'
  | 'telemetry.crash-report'
  | 'telemetry.usage-metrics';

/**
 * Centralized, reactive Gate & Policy Service.
 *
 * Implements a strict fail-closed authorization engine across all privileged
 * abilities (cloud sync, telemetry egress, AI subscription models).
 */
class GateService {
  /**
   * Evaluate whether an ability is authorized under current auth and settings.
   * Returns a structured `{ allowed: boolean, reason?: string }` object.
   */
  gate(ability: AbilityName): GateResult {
    switch (ability) {
      case 'cloud-sync-egress':
      case 'sync.egress': {
        if (!authService.isLoggedIn) {
          return { allowed: false, reason: 'Cloud sync requires a signed-in account.' };
        }
        if (!authService.entitlements?.includes('sync:settings')) {
          return {
            allowed: false,
            reason:
              'Cloud sync requires an active subscription with the sync:settings entitlement.',
          };
        }
        const syncEnabled = settingsService.getSettings().user?.syncEnabled ?? true;
        if (!syncEnabled) {
          return { allowed: false, reason: 'Cloud sync is disabled in settings.' };
        }
        return { allowed: true };
      }

      case 'ai-cloud-models':
      case 'ai.cloud-models': {
        if (!authService.isLoggedIn) {
          return { allowed: false, reason: 'Cloud AI models require a signed-in account.' };
        }
        const hasEntitlement =
          (authService.entitlements?.includes('ai:advanced-models') ?? false) ||
          (authService.entitlements?.includes('ai:chat') ?? false);
        if (!hasEntitlement) {
          return {
            allowed: false,
            reason: 'This AI model requires an active Pro subscription.',
          };
        }
        return { allowed: true };
      }

      case 'ai-conversation-sync':
      case 'sync.ai-conversations': {
        if (!authService.isLoggedIn) {
          return { allowed: false, reason: 'AI history sync requires a signed-in account.' };
        }
        if (!authService.entitlements?.includes('sync:ai-conversations')) {
          return {
            allowed: false,
            reason: 'AI history sync requires the sync:ai-conversations entitlement.',
          };
        }
        const syncEnabled = settingsService.getSettings().user?.syncEnabled ?? true;
        if (!syncEnabled) {
          return { allowed: false, reason: 'Cloud sync is disabled in settings.' };
        }
        return { allowed: true };
      }

      case 'telemetry-crash-report':
      case 'telemetry.crash-report': {
        const mode = settingsService.getSettings().privacy.crashReportMode;
        if (mode === 'off') {
          return { allowed: false, reason: 'Crash reporting is disabled in settings.' };
        }
        return { allowed: true };
      }

      case 'telemetry-usage-share':
      case 'telemetry.usage-metrics': {
        const mode = settingsService.getSettings().privacy.usageShareMode;
        if (mode === 'off') {
          return { allowed: false, reason: 'Anonymous usage metrics sharing is disabled.' };
        }
        return { allowed: true };
      }

      default: {
        // Support direct entitlement checks (e.g. 'sync:settings', 'ai:chat') with strict fail-closed
        if (typeof ability === 'string' && ability.includes(':')) {
          if (!authService.isLoggedIn) {
            return { allowed: false, reason: 'This feature requires a signed-in account.' };
          }
          if (authService.entitlements?.includes(ability)) {
            return { allowed: true };
          }
          return {
            allowed: false,
            reason: `This feature requires the '${ability}' subscription entitlement.`,
          };
        }
        // Fail-closed for unknown abilities
        return { allowed: false, reason: `Unknown ability '${ability}'.` };
      }
    }
  }

  /**
   * Check if an ability is allowed. Returns true or false.
   */
  allows(ability: AbilityName): boolean {
    return this.gate(ability).allowed;
  }

  /**
   * Check if an ability is denied. Returns true if denied, false if allowed.
   */
  denies(ability: AbilityName): boolean {
    return !this.allows(ability);
  }

  /**
   * Assert that an ability is allowed. Throws an Error with the reason if denied.
   */
  authorize(ability: AbilityName): void {
    const result = this.gate(ability);
    if (!result.allowed) {
      throw new Error(result.reason ?? `Access denied for ability '${ability}'`);
    }
  }
}

export const gate = new GateService();
