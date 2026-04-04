import { describe, it, expect } from 'vitest';
import { stripHtml, stripRtf } from './textUtils';

describe('stripHtml', () => {
  it('strips simple tags', () => {
    expect(stripHtml('<p>hello</p>')).toBe('hello');
  });

  it('strips nested tags', () => {
    expect(stripHtml('<div><p>hello <b>world</b></p></div>')).toBe('hello world');
  });

  it('strips full HTML documents', () => {
    const html = '<html><head><meta charset="UTF-8"><style>body{color:red}</style></head><body><p>quarterly report</p></body></html>';
    expect(stripHtml(html)).toContain('quarterly report');
    expect(stripHtml(html)).not.toContain('<');
    expect(stripHtml(html)).not.toContain('color:red');
  });

  it('strips script tags and their content', () => {
    expect(stripHtml('<p>safe</p><script>alert("xss")</script>')).toBe('safe');
  });

  it('strips style tags and their content', () => {
    expect(stripHtml('<style>.a{color:red}</style><p>text</p>')).toBe('text');
  });

  it('decodes common HTML entities', () => {
    expect(stripHtml('a &amp; b &lt; c &gt; d &quot;e&quot;')).toBe('a & b < c > d "e"');
  });

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  hello  </p>  <p>  world  </p>')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(stripHtml('no tags here')).toBe('no tags here');
  });
});

describe('stripRtf', () => {
  it('strips RTF control words', () => {
    const result = stripRtf('{\\rtf1\\b hello\\b0 world}');
    expect(result).toContain('hello');
    expect(result).toContain('world');
    expect(result).not.toContain('\\rtf');
    expect(result).not.toContain('\\b');
  });

  it('strips unicode escape sequences', () => {
    expect(stripRtf('\\u8230?')).not.toContain('\\u8230');
  });

  it('strips braces and backslashes', () => {
    const result = stripRtf('{\\rtf1 {\\b bold} text}');
    expect(result).not.toContain('{');
    expect(result).not.toContain('}');
  });

  it('collapses whitespace', () => {
    const result = stripRtf('{\\rtf1   hello    world  }');
    expect(result).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(stripRtf('')).toBe('');
  });
});
