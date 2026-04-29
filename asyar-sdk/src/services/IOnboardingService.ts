/**
 * Signals to the launcher that this extension's onboarding flow has
 * completed. The launcher marks the extension as onboarded and re-dispatches
 * whichever command the user originally tried to run that triggered
 * onboarding. Idempotent — calling on an already-onboarded extension is a
 * no-op. Permissions: implicit; the IPC router auto-injects extensionId so
 * extensions cannot complete onboarding for a different extension.
 */
export interface IOnboardingService {
  complete(): Promise<void>;
}
