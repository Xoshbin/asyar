/** Restrict links crossing the isolated provider-content boundary. */
export function externalSearchUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Preserve Google's supplied HTML/CSS in an opaque-origin sandbox.
 * CSP permits only our nonce-bearing bridge; provider scripts and handlers
 * cannot run. The caller must never grant allow-same-origin or navigation.
 */
export function searchSuggestionsDocument(html: string, nonce: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(nonce)) throw new Error('Invalid script nonce');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data: https://www.gstatic.com https://www.google.com; base-uri 'none'; form-action 'none'">
<script nonce="${nonce}">
document.addEventListener('click', event => {
  const link = event.target.closest?.('a');
  if (!link) return;
  event.preventDefault();
  if (event.isTrusted) parent.postMessage({type: 'google-search-link', token: '${nonce}', url: link.href}, '*');
}, true);
document.addEventListener('DOMContentLoaded', () => {
  new ResizeObserver(() => parent.postMessage({type: 'google-search-size', token: '${nonce}', height: document.documentElement.scrollHeight}, '*')).observe(document.body);
});
</script></head><body>${html}</body></html>`;
}

export function isSearchSuggestionsMessage(
  event: MessageEvent,
  frame: Window | null | undefined,
  token: string,
): boolean {
  return !!frame && event.source === frame && !!token && event.data?.token === token;
}
