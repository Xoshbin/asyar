// One-shot emoji font prewarm.
//
// The first emoji WebKit renders pays for walking the font fallback chain
// per glyph — a visible hitch the first time search results, snippets, or
// clipboard history contain emoji. Rendering a small representative sample
// offscreen moves that cost to startup idle time.

let prewarmed = false;

/** Representative sample across common Unicode emoji blocks — enough to
 * fault in Apple Color Emoji and resolve the fallback chain, not an
 * exhaustive glyph set. */
const SAMPLE = '😀👍❤️🎉🔥🚀✨⚠️✅❌🌍🕐📋🔒';

export function prewarmEmojiFont(): void {
  if (prewarmed || typeof document === 'undefined' || !document.body) return;
  prewarmed = true;

  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  // Offscreen but NOT display:none / visibility:hidden — the glyphs must
  // reach both layout (fallback-chain resolution) and paint (glyph
  // rasterization) for the font caches to actually warm.
  probe.style.cssText =
    'position:fixed;left:-10000px;top:0;pointer-events:none;font-size:16px;';
  probe.textContent = SAMPLE;
  document.body.appendChild(probe);

  // Two rAFs: give WebKit a full layout + paint pass before tearing down.
  requestAnimationFrame(() => requestAnimationFrame(() => probe.remove()));
}
