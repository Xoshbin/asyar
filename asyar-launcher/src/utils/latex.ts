/**
 * LaTeX rendering utility using KaTeX.
 *
 * Detects LaTeX math delimiters in text and renders them to HTML:
 *   - Display math:  `$$...$$`  or  `\[...\]`
 *   - Inline math:   `$...$`   or  `\(...\)`
 *
 * AI models commonly use `\(...\)` / `\[...\]` (standard LaTeX delimiters),
 * while markdown-style content tends to use `$` / `$$`.  Both are supported.
 *
 * Two rendering strategies are provided:
 *
 * 1. **Post-HTML** (`renderLatexInHtml`):  Best when the markdown renderer
 *    does NOT eat backslashes (e.g. the AI Chat's hand-rolled renderer).
 *
 * 2. **Pre-markdown** (`extractLatexBeforeMarkdown` + `restoreLatex`):
 *    Best when using a full markdown parser like `marked` that treats `\`
 *    as an escape character, stripping it from `\[`, `\(`, etc.
 *
 * Graceful degradation: if KaTeX fails to parse a formula, the raw LaTeX
 * source is shown in a styled span instead of crashing.
 */
import katex from 'katex';

// ── KaTeX CSS injection ─────────────────────────────────────────────────
// We inject the KaTeX stylesheet once, lazily, when the first render
// is requested.  This avoids polluting the global bundle for features
// that never touch LaTeX.
let cssInjected = false;

function injectKatexCss(): void {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/node_modules/katex/dist/katex.min.css';

  try {
    // @ts-expect-error – Vite handles `?url` imports at build time
    import('katex/dist/katex.min.css?url').then((mod) => {
      link.href = mod.default;
      document.head.appendChild(link);
    }).catch(() => {
      document.head.appendChild(link);
    });
  } catch {
    document.head.appendChild(link);
  }
}

// ── Rendering helpers ───────────────────────────────────────────────────

function renderKatex(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
    });
  } catch {
    const escaped = latex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<code class="katex-error" title="LaTeX parse error">${escaped}</code>`;
  }
}

// Sentinel used in pre-markdown extraction placeholders
const LATEX_PLACEHOLDER = '\x02LATEX';

// ── Public API ──────────────────────────────────────────────────────────

/**
 * **Strategy 1 — Post-HTML processing.**
 *
 * Process an HTML string that may contain LaTeX math delimiters and replace
 * them with rendered KaTeX HTML.  Use this when the upstream renderer does
 * NOT strip backslashes (e.g. the AI Chat's hand-rolled markdown function).
 *
 * The function handles (in order):
 *   1. Display blocks  `$$...$$`
 *   2. Display blocks  `\[...\]`
 *   3. Inline formulas `$...$`
 *   4. Inline formulas `\(...\)`
 */
export function renderLatexInHtml(html: string): string {
  injectKatexCss();

  // 1. Protect existing code blocks from processing
  const preserved: string[] = [];
  let processed = html.replace(/<code[\s>][\s\S]*?<\/code>|<pre[\s>][\s\S]*?<\/pre>/gi, (match) => {
    const idx = preserved.length;
    preserved.push(match);
    return `\x01PRESERVED${idx}\x01`;
  });

  // 2. Display math: $$...$$
  processed = processed.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => {
    return renderKatex(latex.trim(), true);
  });

  // 3. Display math: \[...\]
  processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (_match, latex: string) => {
    return renderKatex(latex.trim(), true);
  });

  // 4. Inline math: $...$
  processed = processed.replace(
    /(?<![\\$])(?<!\w)\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g,
    (_match, latex: string) => {
      return renderKatex(latex, false);
    },
  );

  // 5. Inline math: \(...\)
  processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (_match, latex: string) => {
    return renderKatex(latex.trim(), false);
  });

  // 6. Restore preserved code blocks
  preserved.forEach((block, idx) => {
    processed = processed.replace(`\x01PRESERVED${idx}\x01`, block);
  });

  return processed;
}

/**
 * **Strategy 2 — Pre-markdown extraction.**
 *
 * Extracts LaTeX blocks from *raw text* BEFORE it is processed by a
 * markdown parser (like `marked`) that would strip backslashes from
 * `\[`, `\(`, etc.
 *
 * Returns the text with LaTeX replaced by opaque placeholders, plus a
 * `restore` function to call on the HTML *after* markdown rendering.
 *
 * Usage:
 * ```ts
 * const { text, restore } = extractLatexBeforeMarkdown(raw);
 * const html = marked.parse(text);
 * const final = restore(html);
 * ```
 */
export function extractLatexBeforeMarkdown(raw: string): {
  text: string;
  restore: (html: string) => string;
} {
  const slots: Array<{ latex: string; display: boolean }> = [];

  let text = raw;

  // 1. Display: $$...$$ (multiline)
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
    const idx = slots.length;
    slots.push({ latex: latex.trim(), display: true });
    return `${LATEX_PLACEHOLDER}${idx}\x02`;
  });

  // 2. Display: \[...\] (multiline)
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, latex: string) => {
    const idx = slots.length;
    slots.push({ latex: latex.trim(), display: true });
    return `${LATEX_PLACEHOLDER}${idx}\x02`;
  });

  // 3. Inline: $...$
  text = text.replace(
    /(?<![\\$])(?<!\w)\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\d)/g,
    (_m, latex: string) => {
      const idx = slots.length;
      slots.push({ latex, display: false });
      return `${LATEX_PLACEHOLDER}${idx}\x02`;
    },
  );

  // 4. Inline: \(...\)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, latex: string) => {
    const idx = slots.length;
    slots.push({ latex: latex.trim(), display: false });
    return `${LATEX_PLACEHOLDER}${idx}\x02`;
  });

  function restore(html: string): string {
    if (slots.length === 0) return html;
    injectKatexCss();

    return html.replace(
      /\x02LATEX(\d+)\x02/g,
      (_m, idxStr: string) => {
        const idx = parseInt(idxStr, 10);
        const slot = slots[idx];
        if (!slot) return _m;
        return renderKatex(slot.latex, slot.display);
      },
    );
  }

  return { text, restore };
}

/**
 * Quick check whether a string likely contains LaTeX math.
 * Useful for skipping the (heavier) render pass when there's nothing to do.
 */
export function containsLatex(text: string): boolean {
  return /\$\$.+?\$\$|\$[^$\n]+?\$|\\\[[\s\S]+?\\\]|\\\([^)]+?\\\)/s.test(text);
}

