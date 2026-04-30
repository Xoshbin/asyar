import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('latex utility', () => {
  let renderLatexInHtml: (html: string) => string;
  let containsLatex: (text: string) => boolean;
  let extractLatexBeforeMarkdown: (raw: string) => {
    text: string;
    restore: (html: string) => string;
  };

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./latex');
    renderLatexInHtml = mod.renderLatexInHtml;
    containsLatex = mod.containsLatex;
    extractLatexBeforeMarkdown = mod.extractLatexBeforeMarkdown;
  });

  // ── containsLatex ────────────────────────────────────────

  describe('containsLatex', () => {
    it('detects inline math with $ delimiters', () => {
      expect(containsLatex('The formula $E=mc^2$ is famous')).toBe(true);
    });

    it('detects display math with $$ delimiters', () => {
      expect(containsLatex('$$\\int_0^1 x\\,dx$$')).toBe(true);
    });

    it('detects inline math with \\( \\) delimiters', () => {
      expect(containsLatex('where \\(a\\), \\(b\\) are real')).toBe(true);
    });

    it('detects display math with \\[ \\] delimiters', () => {
      expect(containsLatex('\\[\nx^2 + y^2 = r^2\n\\]')).toBe(true);
    });

    it('returns false for plain text', () => {
      expect(containsLatex('Hello world, no math here')).toBe(false);
    });

    it('returns false for lone dollar signs with spaces', () => {
      expect(containsLatex('Price is $ 5.00')).toBe(false);
    });
  });

  // ── renderLatexInHtml (Strategy 1 — post-HTML) ───────────

  describe('renderLatexInHtml', () => {
    it('renders inline math ($...$) to KaTeX HTML', () => {
      const result = renderLatexInHtml('<p>Check $x^2$ here</p>');
      expect(result).toContain('katex');
      expect(result).not.toContain('$x^2$');
    });

    it('renders display math ($$...$$) to KaTeX HTML', () => {
      const result = renderLatexInHtml('<p>$$\\frac{a}{b}$$</p>');
      expect(result).toContain('katex');
      expect(result).toContain('katex-display');
    });

    it('renders inline math \\(...\\) to KaTeX HTML', () => {
      const result = renderLatexInHtml('<p>where \\(a\\) and \\(b\\) are real</p>');
      expect(result).toContain('katex');
      expect(result).not.toContain('\\(a\\)');
    });

    it('renders display math \\[...\\] to KaTeX HTML', () => {
      const result = renderLatexInHtml('<p>\\[x^2 + y^2 = r^2\\]</p>');
      expect(result).toContain('katex');
      expect(result).toContain('katex-display');
      expect(result).not.toContain('\\[');
    });

    it('renders multiline \\[...\\] display math', () => {
      const input = '<p>The formula<br>\\[\nx = \\frac{-b}{2a}\n\\]<br>is important.</p>';
      const result = renderLatexInHtml(input);
      expect(result).toContain('katex-display');
    });

    it('does not touch dollar signs inside <code> tags', () => {
      const input = '<code>$x + 1$</code>';
      const result = renderLatexInHtml(input);
      expect(result).toBe(input);
    });

    it('does not touch dollar signs inside <pre> tags', () => {
      const input = '<pre><code>$x + 1$</code></pre>';
      const result = renderLatexInHtml(input);
      expect(result).toBe(input);
    });

    it('renders multiple inline formulas in one string', () => {
      const result = renderLatexInHtml('<p>$a$ and $b$</p>');
      const matches = result.match(/class="katex"/g);
      expect(matches?.length).toBe(2);
    });

    it('does not match currency-like $5', () => {
      const input = '<p>Costs $5 today</p>';
      const result = renderLatexInHtml(input);
      expect(result).not.toContain('katex');
    });

    it('handles invalid LaTeX gracefully (no throw)', () => {
      const result = renderLatexInHtml('<p>$$\\invalid{$$</p>');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('handles mixed code and math', () => {
      const input = '<p>See <code>$x</code> vs $y^2$ formula</p>';
      const result = renderLatexInHtml(input);
      expect(result).toContain('<code>$x</code>');
      expect(result).toContain('katex');
    });

    it('handles mixed \\( \\) and $ delimiters in same string', () => {
      const input = '<p>Inline \\(a^2\\) and also $b^2$ here</p>';
      const result = renderLatexInHtml(input);
      const matches = result.match(/class="katex"/g);
      expect(matches?.length).toBe(2);
    });

    it('handles \\( \\) with complex expressions', () => {
      const input = '<p>where \\(a \\neq 0\\)</p>';
      const result = renderLatexInHtml(input);
      expect(result).toContain('katex');
      expect(result).not.toContain('\\(a \\neq 0\\)');
    });
  });

  // ── extractLatexBeforeMarkdown (Strategy 2 — pre-markdown) ───

  describe('extractLatexBeforeMarkdown', () => {
    it('extracts $$...$$ and restores as rendered KaTeX', () => {
      const { text, restore } = extractLatexBeforeMarkdown('Hello $$x^2$$ world');
      // Placeholder should replace the LaTeX
      expect(text).not.toContain('$$');
      expect(text).toContain('Hello');
      expect(text).toContain('world');
      // After restore, the KaTeX should be rendered
      const html = restore(`<p>${text}</p>`);
      expect(html).toContain('katex');
    });

    it('extracts \\[...\\] and restores as display KaTeX', () => {
      const { text, restore } = extractLatexBeforeMarkdown('Formula:\n\\[\nx^2\n\\]\nEnd');
      expect(text).not.toContain('\\[');
      expect(text).not.toContain('\\]');
      const html = restore(`<p>${text}</p>`);
      expect(html).toContain('katex-display');
    });

    it('extracts $...$ and restores as inline KaTeX', () => {
      const { text, restore } = extractLatexBeforeMarkdown('The value $a$ is positive');
      expect(text).not.toContain('$a$');
      const html = restore(`<p>${text}</p>`);
      expect(html).toContain('katex');
      // Should NOT be display mode
      expect(html).not.toContain('katex-display');
    });

    it('extracts \\(...\\) and restores as inline KaTeX', () => {
      const { text, restore } = extractLatexBeforeMarkdown('where \\(a \\neq 0\\)');
      expect(text).not.toContain('\\(');
      expect(text).not.toContain('\\)');
      const html = restore(`<p>${text}</p>`);
      expect(html).toContain('katex');
    });

    it('handles multiple LaTeX blocks in the same string', () => {
      const input = 'Solve \\(ax^2+bx+c=0\\) using\n\\[\nx = \\frac{-b}{2a}\n\\]\nwhere \\(a \\neq 0\\).';
      const { text, restore } = extractLatexBeforeMarkdown(input);
      // All LaTeX should be replaced with placeholders
      expect(text).not.toContain('\\(');
      expect(text).not.toContain('\\[');
      const html = restore(`<p>${text}</p>`);
      // Should have both inline and display KaTeX
      const katexMatches = html.match(/class="katex"/g);
      expect(katexMatches!.length).toBeGreaterThanOrEqual(3);
    });

    it('returns identity restore when no LaTeX is present', () => {
      const { text, restore } = extractLatexBeforeMarkdown('No math here');
      expect(text).toBe('No math here');
      const html = '<p>No math here</p>';
      expect(restore(html)).toBe(html);
    });

    it('survives a markdown parser stripping backslashes', () => {
      // Simulate what marked does: backslashes before [ and ( are stripped
      const raw = 'Formula \\[x^2\\] and \\(y\\) here';
      const { text, restore } = extractLatexBeforeMarkdown(raw);
      // Simulate marked stripping remaining backslashes (shouldn't be any LaTeX left)
      const markedOutput = text.replace(/\\([[\]()])/g, '$1');
      const html = restore(`<p>${markedOutput}</p>`);
      expect(html).toContain('katex');
    });
  });
});
