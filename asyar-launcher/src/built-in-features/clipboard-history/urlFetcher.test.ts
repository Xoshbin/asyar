/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchUrlContent } from './urlFetcher';

function makeNetwork(body: string, ok = true) {
  return {
    fetch: vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, statusText: ok ? 'OK' : 'Not Found', body, headers: {} }),
  };
}

describe('fetchUrlContent', () => {
  beforeEach(() => {
    // Clear module-level cache between tests by re-importing fresh or just
    // testing observable behaviour (the cache is an implementation detail).
  });

  it('returns ok with extracted content for SSR article page', async () => {
    const html = `<html><body>
      <nav>Nav</nav>
      <article>${'<p>Real content paragraph.</p>'.repeat(20)}</article>
      <footer>Footer</footer>
    </body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://example.com/article', network as any);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.html).toContain('Real content paragraph');
      expect(result.html).not.toContain('<nav>');
      expect(result.html).not.toContain('<footer>');
    }
  });

  it('returns empty for SPA shell (no meaningful content)', async () => {
    const html = `<html><body><div id="root"></div><script>window.__INIT__={}</script></body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://spa.example.com/', network as any);
    expect(result.status).toBe('empty');
  });

  it('returns error on network failure', async () => {
    const network = { fetch: vi.fn().mockRejectedValue(new Error('timeout')) };
    const result = await fetchUrlContent('https://down.example.com/', network as any);
    expect(result.status).toBe('error');
  });

  it('returns error on non-ok response', async () => {
    const network = makeNetwork('Not Found', false);
    const result = await fetchUrlContent('https://example.com/404', network as any);
    expect(result.status).toBe('error');
  });

  it('fixes relative image src to absolute', async () => {
    const content = '<p>This is a content paragraph with enough text to pass the minimum length threshold.</p>'.repeat(5);
    const html = `<html><body><article>${content}<img src="/images/photo.png"/></article></body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://example.com/post-img', network as any);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.html).toContain('https://example.com/images/photo.png');
    }
  });

  it('fixes relative link href to absolute and adds target=_blank', async () => {
    const content = '<p>This is a content paragraph with enough text to pass the minimum length threshold.</p>'.repeat(5);
    const html = `<html><body><article>${content}<a href="/about">About</a></article></body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://example.com/post-link', network as any);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.html).toContain('https://example.com/about');
      expect(result.html).toContain('target="_blank"');
    }
  });

  it('strips script tags from extracted content', async () => {
    const content = '<p>This is a content paragraph with enough text to pass the minimum length threshold.</p>'.repeat(5);
    const html = `<html><body><article>${content}<script>alert(1)</script></article></body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://example.com/post', network as any);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.html).not.toContain('<script>');
    }
  });

  it('uses main selector when article not present', async () => {
    const content = '<p>Main content paragraph with enough text to pass the minimum length threshold.</p>'.repeat(5);
    const html = `<html><body><nav>Nav</nav><main>${content}</main></body></html>`;
    const network = makeNetwork(html);
    const result = await fetchUrlContent('https://example.com/page', network as any);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.html).toContain('Main content');
    }
  });
});
