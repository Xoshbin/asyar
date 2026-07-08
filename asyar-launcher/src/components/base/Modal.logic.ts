const ACTIONABLE_ROLES = new Set(['button', 'link', 'menuitem', 'option', 'tab']);

// Enter should not trigger a dialog's default action when focus is on a
// control that already owns Enter itself — a focused Cancel button (native
// Enter-as-click), a link, or a textarea (Enter inserts a newline). Plain
// text inputs are intentionally excluded: Enter-to-submit while a text field
// is focused is the expected behavior in passphrase/form dialogs.
export function isActionableElementFocused(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLButtonElement) return true;
  if (el instanceof HTMLAnchorElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  const role = el.getAttribute('role');
  return role !== null && ACTIONABLE_ROLES.has(role);
}

export function isAnyModalOpen(doc: Document): boolean {
  return doc.querySelector(':modal') !== null;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]';

// Fallback focus target for WebKit's native <dialog> focus-trap gap (focus
// can drop to document.body mid-Tab instead of cycling — a documented engine
// bug, not app-specific). Checks `disabled` explicitly rather than trusting
// `.tabIndex` alone: jsdom's tabIndex reflection ignores `disabled` (returns
// 0), unlike real browsers, so relying on it here would hide real bugs.
export function getFirstFocusable(container: HTMLElement): HTMLElement | null {
  const candidates = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    if (el.hasAttribute('disabled')) continue;
    if (el.tabIndex < 0) continue;
    return el;
  }
  return null;
}
