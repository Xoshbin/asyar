// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  searchSuggestionsDocument,
  externalSearchUrl,
  isSearchSuggestionsMessage,
} from './googleSearchSuggestions';

describe('Google Search Suggestions isolation', () => {
  it('retains provider HTML with only the trusted bridge permitted by CSP', () => {
    const html =
      '<style>.chip { color: red }</style><a href="https://google.com/search?q=test">Test</a><script>alert(1)</script>';
    const result = searchSuggestionsDocument(html, 'random-nonce');
    expect(result).toContain(html);
    const document = new DOMParser().parseFromString(result, 'text/html');
    const policy = document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')!
      .getAttribute('content')!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'nonce-random-nonce'");
    expect(policy).toContain("base-uri 'none'");
    expect(document.querySelectorAll('script[nonce="random-nonce"]')).toHaveLength(1);
    expect(policy).not.toContain("script-src 'unsafe-inline'");
  });
  it('permits only HTTP(S) links, excluding credentials and dangerous protocols', () => {
    expect(externalSearchUrl('https://example.com/a')).toBe('https://example.com/a');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///tmp/a',
      'https://user:pass@example.com',
      null,
    ]) {
      expect(externalSearchUrl(value)).toBeNull();
    }
  });
});

it('rejects messages from other frames or a navigated document without the bridge token', () => {
  const frame = {} as Window;
  const event = {
    source: frame,
    data: { token: 'secret', type: 'google-search-link' },
  } as MessageEvent;
  expect(isSearchSuggestionsMessage(event, frame, 'secret')).toBe(true);
  expect(isSearchSuggestionsMessage(event, {} as Window, 'secret')).toBe(false);
  expect(
    isSearchSuggestionsMessage(
      { ...event, data: { type: 'google-search-link' } } as MessageEvent,
      frame,
      'secret',
    ),
  ).toBe(false);
});
