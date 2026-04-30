import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('markdown utility', () => {
  it('renders basic markdown to HTML', () => {
    const html = renderMarkdown('# Hello\nThis is **bold** and *italic*.');
    expect(html).toContain('<h1');
    expect(html).toContain('Hello');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders LaTeX math correctly using the shared flow', () => {
    const html = renderMarkdown('The formula is \\(E=mc^2\\).');
    expect(html).toContain('katex');
    expect(html).not.toContain('\\(E=mc^2\\)');
  });

  it('renders display math correctly', () => {
    const html = renderMarkdown('$$\n\\int_0^1 x dx\n$$');
    expect(html).toContain('katex-display');
  });

  it('renders tables correctly (which the old AI renderer missed)', () => {
    const table = '| A | B |\n|---|---|\n| 1 | 2 |';
    const html = renderMarkdown(table);
    expect(html).toContain('<table');
    expect(html).toContain('<td>1</td>');
  });

  it('renders markdown with standard design system classes and syntax highlighting', () => {
    const html = renderMarkdown('```ts\nconst x = 1;\n```');
    // Check for the shared classes
    expect(html).toContain('md-code-block');
    // Check for Prism tokens
    expect(html).toContain('token keyword');
    expect(html).toContain('token number');
    // DESIGN LANGUAGE: Ensure it uses standard .btn classes
    expect(html).toContain('class="md-copy-btn btn btn-secondary"');
  });

  it('renders fenced code blocks with the custom header and copy button', () => {
    const code = '```ts\nconst x = 1;\n```';
    const html = renderMarkdown(code);
    expect(html).toContain('md-code-block');
    expect(html).toContain('md-code-header');
    expect(html).toContain('md-copy-btn');
    // Content is now highlighted with spans
    expect(html).toContain('token keyword');
  });
  
  it('highlights PHP code blocks', () => {
    const html = renderMarkdown('```php\necho "Hello";\n```');
    expect(html).toContain('language-php');
    expect(html).toContain('token keyword');
  });

  it('identifies mermaid blocks', () => {
    const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
    expect(html).toContain('<div class="mermaid">graph TD; A-->B;</div>');
  });

  it('sanitizes script tags for security', () => {
    const dangerous = 'Hello <script>alert(1)</script> world';
    const html = renderMarkdown(dangerous);
    expect(html).not.toContain('<script');
    expect(html).toContain('Hello  world');
  });

  it('sanitizes event handlers', () => {
    const dangerous = '<img src=x onerror=alert(1)>';
    const html = renderMarkdown(dangerous);
    expect(html).not.toContain('onerror');
    expect(html).toContain('<img src=x>');
  });

  it('handles truncation correctly', () => {
    const long = 'ABCDEFG';
    const html = renderMarkdown(long, { maxChars: 3 });
    expect(html).toContain('ABC');
    expect(html).not.toContain('DEFG');
  });
});
