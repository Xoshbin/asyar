/**
 * Shared markdown rendering utility.
 *
 * Uses `marked` as the parser with LaTeX math support via KaTeX.
 * All features that need markdown → HTML should use this module
 * instead of rolling their own renderer.
 *
 * Features:
 *   - Full CommonMark markdown (headings, bold, italic, code, lists,
 *     tables, blockquotes, images, links, horizontal rules)
 *   - Fenced code blocks with language labels and a copy button
 *   - LaTeX math: `$...$`, `$$...$$`, `\(...\)`, `\[...\]`
 *   - HTML sanitisation (strips `<script>`, event handlers)
 */
import { marked } from 'marked';
import { extractLatexBeforeMarkdown, containsLatex } from './latex';

// ── Configure marked ────────────────────────────────────────────────────

// Custom renderer to inject a copy-button header into fenced code blocks
const renderer = new marked.Renderer();
const originalCodeRenderer = renderer.code;

renderer.code = function (token) {
  // `token` has shape  { text, lang, escaped }
  const lang = token.lang ?? '';
  const code = token.text ?? '';
  const langLabel = lang
    ? `<span class="md-code-lang">${lang}</span>`
    : '';

  return (
    `<div class="md-code-block">` +
      `<div class="md-code-header">${langLabel}<button class="md-copy-btn" data-code="${encodeURIComponent(code)}">Copy</button></div>` +
      `<pre><code class="language-${lang}">${code}</code></pre>` +
    `</div>`
  );
};

// ── Sanitisation ────────────────────────────────────────────────────────

function sanitize(html: string): string {
  // Strip <script> tags
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Strip on* event handlers
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return clean;
}

// ── Public API ──────────────────────────────────────────────────────────

export interface RenderMarkdownOptions {
  /** Maximum number of characters to process (default: 50 000). */
  maxChars?: number;
  /** Enable line breaks on single newlines (default: true). */
  breaks?: boolean;
}

/**
 * Render a markdown string (with optional LaTeX) to sanitised HTML.
 *
 * The returned HTML uses `.md-*` class names so that a single set of
 * CSS rules (defined in `style.css`) styles it consistently everywhere.
 *
 * @example
 * ```ts
 * import { renderMarkdown } from '../../utils/markdown';
 * const html = renderMarkdown(text);
 * ```
 */
export function renderMarkdown(
  text: string,
  options: RenderMarkdownOptions = {},
): string {
  const { maxChars = 50_000, breaks = true } = options;

  const input = text.length > maxChars
    ? text.substring(0, maxChars)
    : text;

  // 1. Extract LaTeX before marked can strip backslashes from \[ \( etc.
  const hasLatex = containsLatex(input);
  const { text: safeText, restore } = hasLatex
    ? extractLatexBeforeMarkdown(input)
    : { text: input, restore: (h: string) => h };

  // 2. Run marked
  let html = marked.parse(safeText, {
    async: false,
    breaks,
    renderer,
  }) as string;

  // 3. Restore LaTeX placeholders → KaTeX HTML
  html = restore(html);

  // 4. Sanitise
  html = sanitize(html);

  return html;
}

/**
 * Delegate handler for copy-button clicks inside rendered markdown.
 *
 * Attach this to a parent container with event delegation:
 * ```svelte
 * <div onclick={handleMarkdownCopyClick}>
 *   {@html renderMarkdown(text)}
 * </div>
 * ```
 */
export function handleMarkdownCopyClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement).closest(
    'button.md-copy-btn',
  ) as HTMLButtonElement | null;
  if (!btn) return;

  const code = decodeURIComponent(btn.dataset.code ?? '');
  navigator.clipboard.writeText(code).catch((err) =>
    console.warn('[markdown] Copy to clipboard failed:', err),
  );
  btn.textContent = 'Copied!';
  setTimeout(() => {
    btn.textContent = 'Copy';
  }, 2000);
}
