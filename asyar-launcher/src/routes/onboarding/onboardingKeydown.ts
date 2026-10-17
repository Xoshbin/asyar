export interface OnboardingKeydownOptions {
  onClose: () => void;
}

/**
 * Handles keyboard shortcuts for the onboarding window.
 * Closes the tour on Cmd+W (macOS) or Ctrl+W (Windows/Linux).
 */
export function handleOnboardingKeydown(
  e: KeyboardEvent,
  options: OnboardingKeydownOptions,
): boolean {
  if (e.repeat || e.isComposing) return false;

  const isW = e.code === 'KeyW' || e.key.toLowerCase() === 'w';
  const isPrimary = e.metaKey || e.ctrlKey;
  const noConflictingModifiers = !e.altKey && !e.shiftKey;

  if (isPrimary && noConflictingModifiers && isW) {
    e.preventDefault();
    options.onClose();
    return true;
  }

  return false;
}
