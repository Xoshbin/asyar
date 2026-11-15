// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  extractQueryTerms,
  getItemDisplay,
  highlightInElement,
  normalizeToken,
  parseSnippetChunks,
} from './snippetHighlight';

describe('parseSnippetChunks', () => {
  it('returns empty array for empty, null, or undefined input', () => {
    expect(parseSnippetChunks('')).toEqual([]);
    expect(parseSnippetChunks(null)).toEqual([]);
    expect(parseSnippetChunks(undefined)).toEqual([]);
  });

  it('returns a single non-matching chunk for plain text without markers', () => {
    expect(parseSnippetChunks('hello world')).toEqual([{ text: 'hello world', match: false }]);
  });

  it('parses a single match in the middle of text', () => {
    expect(parseSnippetChunks('hello \x01world\x02!')).toEqual([
      { text: 'hello ', match: false },
      { text: 'world', match: true },
      { text: '!', match: false },
    ]);
  });

  it('parses matches at the start and end of text', () => {
    expect(parseSnippetChunks('\x01apple\x02 and \x01pie\x02')).toEqual([
      { text: 'apple', match: true },
      { text: ' and ', match: false },
      { text: 'pie', match: true },
    ]);
  });

  it('handles adjacent matches without producing empty chunks', () => {
    expect(parseSnippetChunks('\x01apple\x02\x01pie\x02')).toEqual([
      { text: 'apple', match: true },
      { text: 'pie', match: true },
    ]);
  });

  it('handles unclosed start marker gracefully without crashing', () => {
    expect(parseSnippetChunks('some \x01unclosed text')).toEqual([
      { text: 'some ', match: false },
      { text: 'unclosed text', match: true },
    ]);
  });
});

describe('getItemDisplay', () => {
  it('returns standard getItemTitle when query is empty', () => {
    const item = { type: 'text', preview: 'original text' };
    expect(getItemDisplay(item, '')).toEqual({
      title: 'original text',
      titleChunks: undefined,
      subtitle: undefined,
    });
  });

  it('returns highlighted snippet as title when query matches item content', () => {
    const item = {
      type: 'text',
      preview: 'the beginning of a very long text',
      snippet: '…deep \x01apple\x02 match…',
    };
    const display = getItemDisplay(item, 'apple');
    expect(display.title).toBe('…deep apple match…');
    expect(display.titleChunks).toEqual([
      { text: '…deep ', match: false },
      { text: 'apple', match: true },
      { text: ' match…', match: false },
    ]);
    expect(display.subtitle).toBeUndefined();
  });

  it('returns customTitle as title and content snippet as subtitle when matching renamed item body', () => {
    const item = {
      type: 'text',
      preview: 'secret body text',
      customTitle: 'My Custom Note',
      snippet: '…secret \x01code\x02 123…',
    };
    const display = getItemDisplay(item, 'code');
    expect(display.title).toBe('My Custom Note');
    expect(display.titleChunks).toEqual([{ text: 'My Custom Note', match: false }]);
    expect(display.subtitle).toBe('…secret code 123…');
  });

  it('highlights customTitle when match occurs inside the customTitle itself', () => {
    const item = {
      type: 'text',
      preview: 'some body',
      customTitle: 'Important Document',
      snippet: 'Important \x01Document\x02',
    };
    const display = getItemDisplay(item, 'Document');
    expect(display.title).toBe('Important Document');
    expect(display.titleChunks).toEqual([
      { text: 'Important ', match: false },
      { text: 'Document', match: true },
    ]);
    expect(display.subtitle).toBeUndefined();
  });
});

describe('extractQueryTerms', () => {
  it('returns empty array for empty query', () => {
    expect(extractQueryTerms('')).toEqual([]);
    expect(extractQueryTerms('   ')).toEqual([]);
  });

  it('extracts plain words', () => {
    expect(extractQueryTerms('apple pie')).toEqual(['apple', 'pie']);
  });

  it('strips filter tokens like type: and app:', () => {
    expect(extractQueryTerms('type:text app:Safari banana')).toEqual(['banana']);
  });
});

describe('highlightInElement', () => {
  it('wraps matching text in <mark class="search-match"> inside DOM elements', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>The quick brown apple jumped.</p>';
    highlightInElement(div, 'apple');

    const marks = div.querySelectorAll('mark.search-match');
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe('apple');
    expect(div.textContent).toBe('The quick brown apple jumped.');
  });

  it('cleans up marks when query is empty', () => {
    const div = document.createElement('div');
    div.innerHTML = '<p>The quick brown apple jumped.</p>';
    highlightInElement(div, 'apple');
    expect(div.querySelectorAll('mark.search-match')).toHaveLength(1);

    highlightInElement(div, '');
    expect(div.querySelectorAll('mark.search-match')).toHaveLength(0);
    expect(div.textContent).toBe('The quick brown apple jumped.');
  });

  it('does not corrupt HTML elements or attributes', () => {
    const div = document.createElement('div');
    div.innerHTML = '<a href="https://apple.com">apple fruit</a>';
    highlightInElement(div, 'apple');

    const a = div.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://apple.com');
    expect(a?.querySelector('mark.search-match')?.textContent).toBe('apple');
  });
});

it('keeps a contained body snippet below the custom title', () => {
  const display = getItemDisplay(
    { type: 'text', customTitle: 'pineapple notes', snippet: '\x01apple\x02' },
    'apple',
  );
  expect(display.titleChunks).toEqual([{ text: 'pineapple notes', match: false }]);
  expect(display.subtitle).toBe('apple');
});
it('splits punctuation as unicode61 separators', () => {
  expect(extractQueryTerms('foo_bar/baz-qux')).toEqual(['foo', 'bar', 'baz', 'qux']);
});
it('highlights token prefixes but skips interior substrings', () => {
  const div = document.createElement('div');
  div.textContent = 'pineapple APPlication foo_apple';
  highlightInElement(div, 'app');
  expect(Array.from(div.querySelectorAll('mark')).map((m) => m.textContent)).toEqual([
    'APP',
    'app',
  ]);
});

describe('normalizeToken', () => {
  it('strips accents and converts to lowercase', () => {
    expect(normalizeToken('Café')).toBe('cafe');
    expect(normalizeToken('Cafe\u0301')).toBe('cafe');
    expect(normalizeToken('NAÏVE')).toBe('naive');
    expect(normalizeToken('Über')).toBe('uber');
  });
});

it('matches accented customTitle tokens when query is unaccented', () => {
  const item = {
    type: 'text',
    customTitle: 'Café Menu',
    snippet: '\x01Café\x02 Menu',
  };
  const display = getItemDisplay(item, 'cafe');
  expect(display.title).toBe('Café Menu');
  expect(display.titleChunks).toEqual([
    { text: 'Café', match: true },
    { text: ' Menu', match: false },
  ]);
  expect(display.subtitle).toBeUndefined();
});

it('matches unaccented customTitle tokens when query is accented', () => {
  const item = {
    type: 'text',
    customTitle: 'Cafe Menu',
    snippet: '\x01Cafe\x02 Menu',
  };
  const display = getItemDisplay(item, 'café');
  expect(display.title).toBe('Cafe Menu');
  expect(display.titleChunks).toEqual([
    { text: 'Cafe', match: true },
    { text: ' Menu', match: false },
  ]);
  expect(display.subtitle).toBeUndefined();
});
