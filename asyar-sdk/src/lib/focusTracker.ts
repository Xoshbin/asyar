/**
 * Sets up focus tracking for extension iframes.
 *
 * Listens for focusin/focusout events on the document and posts
 * `asyar:extension:input-focus` messages to the parent window when
 * a text-like input gains or loses focus. This lets the launcher
 * suppress global keyboard shortcuts while the user is typing.
 */
export function setupFocusTracking(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const isInput = (el: Element | null): boolean => {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() || 'text';
      const textTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
      return textTypes.includes(type);
    }
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  };

  let currentlyFocused = false;
  const emitFocus = (focused: boolean) => {
    // Only emit if we are in an iframe (sandboxed extension)
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'asyar:extension:input-focus', focused }, '*');
    }
  };

  // Use focusin and focusout because they bubble and capture generic focus changes
  document.addEventListener('focusin', (e) => {
    const active = isInput(e.target as Element);
    if (active !== currentlyFocused) {
      currentlyFocused = active;
      emitFocus(currentlyFocused);
    }
  });

  document.addEventListener('focusout', () => {
    // Small timeout to allow the next element to receive focus
    setTimeout(() => {
      const active = isInput(document.activeElement);
      if (active !== currentlyFocused) {
        currentlyFocused = active;
        emitFocus(currentlyFocused);
      }
    }, 0);
  });
}
