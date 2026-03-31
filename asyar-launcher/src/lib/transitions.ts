import { cubicOut, quartOut } from 'svelte/easing';

/**
 * Subtle fly-in from below for view/tab content entering.
 * Use with `in:viewEnter` on the incoming content.
 */
export function viewEnter(node: Element, params: { duration?: number; y?: number } = {}) {
  const { duration = 150, y = 8 } = params;
  return {
    duration,
    easing: cubicOut,
    css: (t: number) => `
      opacity: ${t};
      transform: translateY(${(1 - t) * y}px);
    `,
  };
}

/**
 * Quick fade-out for view/tab content exiting.
 * Use with `out:viewExit` on the outgoing content.
 */
export function viewExit(node: Element, params: { duration?: number } = {}) {
  const { duration = 100 } = params;
  return {
    duration,
    css: (t: number) => `opacity: ${t};`,
  };
}

/**
 * Scale + fade for popups, dialogs, and overlays.
 * Use with `transition:popupScale` or `in:popupScale`.
 */
export function popupScale(node: Element, params: { duration?: number; start?: number } = {}) {
  const { duration = 120, start = 0.96 } = params;
  return {
    duration,
    easing: cubicOut,
    css: (t: number) => {
      const scale = start + (1 - start) * t;
      return `
        opacity: ${t};
        transform: scale(${scale});
      `;
    },
  };
}

/**
 * Simple fade transition for backdrops and subtle elements.
 */
export function fadeIn(node: Element, params: { duration?: number } = {}) {
  const { duration = 150 } = params;
  return {
    duration,
    css: (t: number) => `opacity: ${t};`,
  };
}
