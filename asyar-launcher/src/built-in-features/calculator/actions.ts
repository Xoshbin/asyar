/** Svelte action: auto-focuses the element on mount */
export function autofocusAction(node: HTMLElement) {
  if (node && typeof node.focus === "function") {
    setTimeout(() => node.focus(), 0);
  }
}

/** Svelte action: signals parent window about input focus/blur for iframe communication */
export function focusSignal(node: HTMLElement) {
  const focus = () => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: true }, window.location.origin);
  const blur = () => window.parent?.postMessage({ type: 'asyar:extension:input-focus', focused: false }, window.location.origin);
  node.addEventListener('focus', focus);
  node.addEventListener('blur', blur);
  return {
    destroy: () => {
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', blur);
    }
  };
}
