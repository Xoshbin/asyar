/**
 * Theme injection for extension iframes.
 *
 * Listens for `asyar:theme:variables` and `asyar:theme:fonts` messages
 * from the host window and injects the corresponding CSS into the
 * document head.
 */

/**
 * Sets up the window message listener that receives theme data from
 * the launcher host and injects it into the document.
 */
export function setupThemeInjection(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.data?.type === 'asyar:theme:variables') {
      const vars = event.data.payload as Record<string, string>;
      if (!vars || typeof vars !== 'object') return;
      injectThemeVariables(vars);
      return;
    }
    if (event.data?.type === 'asyar:theme:fonts') {
      const css = event.data.payload as string;
      if (!css || typeof css !== 'string') return;
      injectFontFaceCSS(css);
      return;
    }
  });
}

/** Inject theme variables into the document as CSS custom properties. */
export function injectThemeVariables(vars: Record<string, string>): void {
  let style = document.getElementById('asyar-theme-vars') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'asyar-theme-vars';
    document.head.appendChild(style);
  }
  const declarations = Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  style.textContent = `:root {\n${declarations}\n}`;
}

/** Inject font-face CSS into the document. */
export function injectFontFaceCSS(css: string): void {
  let style = document.getElementById('asyar-theme-fonts') as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = 'asyar-theme-fonts';
    document.head.appendChild(style);
  }
  style.textContent = css;
}
