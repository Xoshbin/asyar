import { describe, it, expect } from 'vitest';
import { parseUrlPlaceholders } from './parseUrlPlaceholders';

describe('parseUrlPlaceholders', () => {
  it('returns an empty array for a URL with no placeholders', () => {
    expect(parseUrlPlaceholders('https://example.com/search?q=hello')).toEqual([]);
  });

  it('extracts a single placeholder', () => {
    expect(parseUrlPlaceholders('https://example.com/search?q={Query}')).toEqual(['Query']);
  });

  it('extracts multiple placeholders in first-occurrence order', () => {
    expect(
      parseUrlPlaceholders('https://example.com/?q={Query}&from={Clipboard Text}')
    ).toEqual(['Query', 'Clipboard Text']);
  });

  it('dedupes repeated placeholders', () => {
    expect(
      parseUrlPlaceholders('https://example.com/?a={Query}&b={Query}&c={Other}')
    ).toEqual(['Query', 'Other']);
  });

  it('ignores empty braces', () => {
    expect(parseUrlPlaceholders('https://example.com/?a={}')).toEqual([]);
  });

  it('ignores an unclosed `{`', () => {
    expect(parseUrlPlaceholders('https://example.com/?broken={Query')).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseUrlPlaceholders('')).toEqual([]);
  });

  it('extracts a placeholder containing special characters like &', () => {
    expect(parseUrlPlaceholders('https://example.com/?t={Date & Time}')).toEqual(['Date & Time']);
  });

  it('extracts all known placeholder token names', () => {
    const url = 'https://x.com/?a={query}&b={Selected Text}&c={Clipboard Text}&d={UUID}&e={Date}&f={Time}&g={Date & Time}&h={Weekday}';
    expect(parseUrlPlaceholders(url)).toEqual([
      'query', 'Selected Text', 'Clipboard Text', 'UUID', 'Date', 'Time', 'Date & Time', 'Weekday',
    ]);
  });
});
