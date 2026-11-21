export interface OnboardingKeydownOptions {
  onClose: () => void;
  onPrimary?: () => void;
  onSkip?: () => void;
}

// Enter belongs to whatever is focused here: typing, clicking a button, recording a hotkey.
function ownsEnter(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName)
  );
}

/**
 * Handles keyboard shortcuts for the onboarding window.
 * Cmd/Ctrl+W closes the tour, Enter runs the primary action and
 * Cmd/Ctrl+Enter skips the step.
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

  if (e.key === 'Enter' && noConflictingModifiers) {
    const action = isPrimary ? options.onSkip : ownsEnter(e.target) ? undefined : options.onPrimary;
    if (!action) return false;
    e.preventDefault();
    action();
    return true;
  }

  return false;
}
