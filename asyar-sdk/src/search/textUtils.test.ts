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

  it('drops font table content', () => {
    const input = '{\\rtf1\\ansi{\\fonttbl\\f0\\fnil\\fcharset0 .SFNSRounded-Regular;}\\f0 hello world}';
    expect(stripRtf(input)).toBe('hello world');
  });

  it('drops color table content', () => {
    const input = '{\\rtf1{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}\\cf2 body text}';
    expect(stripRtf(input)).toBe('body text');
  });

  it('drops expandedcolortbl with nested groups and labelColor', () => {
    const input = '{\\rtf1{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;\\cssrgb\\c0\\c0\\c0\\labelColor;}body}';
    expect(stripRtf(input)).toBe('body');
  });

  it('decodes \\\'92 as curly apostrophe', () => {
    const input = '{\\rtf1 it\\\'92s fine}';
    expect(stripRtf(input)).toBe('it\u2019s fine');
  });

  it('decodes \\u8217? unicode escape to \u2019', () => {
    const input = '{\\rtf1 it\\u8217?s fine}';
    const result = stripRtf(input);
    expect(result).toContain('\u2019');
    expect(result).not.toContain('u8217');
    expect(result).not.toContain('?');
  });

  it('\\par becomes space', () => {
    const input = '{\\rtf1 line1\\par line2}';
    expect(stripRtf(input)).toBe('line1 line2');
  });

  it('escaped literals \\\\, \\{, \\}', () => {
    const input = '{\\rtf1 a\\{b\\}c\\\\d}';
    expect(stripRtf(input)).toBe('a{b}c\\d');
  });

  it('full real-world TextEdit sample', () => {
    const input = '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2868\\cocoatextscaling0\\cocoaplatform0{\\fonttbl\\f0\\fnil\\fcharset0 .SFNSRounded-Regular;}{\\colortbl;\\red255\\green255\\blue255;\\red0\\green0\\blue0;}{\\*\\expandedcolortbl;;\\cssrgb\\c0\\c0\\c0;\\cssrgb\\c0\\c0\\c0\\labelColor;}\\pard\\pardirnatural\\partightenfactor0\\f0\\fs28 \\cf2 \\expnd0\\expndtw0\\kerning0\\outl0\\strokewidth0 \\strokec2 Fix clipboard history formatting, currently it\\\'92s ugly}';
    const result = stripRtf(input);
    expect(result).toBe('Fix clipboard history formatting, currently it\u2019s ugly');
    ['SFNSRounded', 'JetBrainsMono', 'cocoartf', 'fonttbl', 'colortbl', 'labelColor', 'expandedcolortbl', 'pard', '\\f0', '\\fs28', '\\cf2', '\\\'92', '\\u8217'].forEach(term => {
      expect(result).not.toContain(term);
    });
  });

  it('unknown ignorable destination', () => {
    const input = '{\\rtf1{\\*\\someunknown junk}real text}';
    expect(stripRtf(input)).toBe('real text');
  });

  it('plain text input is preserved', () => {
    const input = 'hello world';
    expect(stripRtf(input)).toBe('hello world');
  });
});
