// asyar-launcher/src/lib/ipc/onboardingCommands.ts
// Tauri command wrappers, re-exported through ./commands (the barrel).
import { invokeSafe } from './invokeSafe';

// ── Onboarding ────────────────────────────────────────────────────────────────

export type OnboardingStepKind =
  | 'welcome'
  | 'summonSearch'
  | 'clipboard'
  | 'portals'
  | 'aiSetup'
  | 'hiddenCommands'
  | 'emoji'
  | 'snippets'
  | 'featuredExtensions'
  | 'pickTheme'
  | 'cheatSheet'
  | 'privacyConsent';

export interface OnboardingState {
  current: OnboardingStepKind;
  total: number;
  position: number;
  isMacos: boolean;
}

export const onboardingCommands = {
  getState: () => invokeSafe<OnboardingState>('get_onboarding_state'),
  advance: () => invokeSafe<OnboardingState>('advance_onboarding_step'),
  goBack: () => invokeSafe<OnboardingState>('go_back_onboarding_step'),
  complete: () => invokeSafe<void>('complete_onboarding'),
  dismiss: () => invokeSafe<void>('dismiss_onboarding'),
  reset: () => invokeSafe<void>('reset_onboarding'),
};

export async function completeAiOnboarding(): Promise<void> {
  await invokeSafe<void>('complete_ai_onboarding');
}

// Silent: onboardingService.svelte.ts is the sole caller and reports its own diagnostic.
export async function isAiOnboardingCompleted(): Promise<boolean | null> {
  return invokeSafe<boolean>('is_ai_onboarding_completed', undefined, { silent: true });
}

export async function resetExtensionOnboarding(extensionId: string): Promise<void> {
  await invokeSafe('reset_extension_onboarding', { extensionId });
}

/** Whether the given extension has completed its onboarding flow. Used by
 *  the launcher's frontend interception for Tier 2 view-mode commands
 *  (which bypass the Rust dispatch path and therefore Plan B's Rust
 *  interception). */
export function isExtensionOnboarded(extensionId: string): Promise<boolean | null> {
  return invokeSafe<boolean>('is_extension_onboarded', { extensionId });
}
