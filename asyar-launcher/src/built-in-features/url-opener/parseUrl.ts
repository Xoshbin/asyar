/**
 * Recognises a typed or pasted web address. Pure and synchronous: it runs on
 * every keystroke in root search, so it never touches IPC or the network.
 *
 * Bare hosts are only accepted when the last label is a known TLD. A loose
 * "word.letters" pattern would turn everyday filenames (`index.ts`, `main.rs`,
 * `Cargo.toml`) into "Open https://…" rows; several real country TLDs
 * (`.rs`, `.py`, `.md`, `.sh`, `.pl`, `.so`, `.app`, `.zip`) are therefore
 * deliberately left out.
 */
export const KNOWN_TLDS: ReadonlySet<string> = new Set(
  (
    'com org net edu gov mil int io dev ai co me info biz xyz tech site online store blog cloud ' +
    'page link news live tv fm gg to ly uk us ca de fr nl es it se no fi dk ch at be ie pt gr cz ' +
    'hu ro ru ua tr ir iq il ae sa in jp cn kr tw hk sg au nz br mx ar cl eu'
  ).split(' '),
);

const MAX_LENGTH = 2048;
const HTTP_URL = /^https?:\/\//i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d{1,5}(?:[/?#]|$))/i;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIpv4(host: string): boolean {
  const m = IPV4.exec(host);
  return m !== null && m.slice(1).every((octet) => Number(octet) <= 255);
}

/** The openable URL (always `http(s)://…`), or `null` when `query` is not one. */
export function parseUrl(query: string): string | null {
  const input = query.trim();
  if (!input || input.length > MAX_LENGTH || /\s/.test(input)) return null;

  if (HTTP_URL.test(input)) {
    try {
      return new URL(input).hostname ? input : null;
    } catch {
      return null;
    }
  }
  if (OTHER_SCHEME.test(input)) return null;

  const authority = input.split(/[/?#]/, 1)[0].replace(/:\d{1,5}$/, '');
  const lower = authority.toLowerCase();

  if (lower === 'localhost' || isIpv4(lower)) return `http://${input}`;

  const labels = lower.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  return KNOWN_TLDS.has(labels[labels.length - 1]) ? `https://${input}` : null;
}
