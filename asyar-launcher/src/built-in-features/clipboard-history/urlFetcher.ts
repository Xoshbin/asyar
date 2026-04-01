import type { INetworkService } from "asyar-sdk";

const cache = new Map<string, { html: string; timestamp: number }>();
const rawCache = new Map<string, { html: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const CONTENT_SELECTORS = [
  "article",
  "[role='main']",
  "main",
  ".article-content",
  ".post-content",
  ".entry-content",
  ".article-body",
  ".story-body",
  ".markdown-body",
  "#content",
  "#main",
  ".content",
];

const MIN_CONTENT_LENGTH = 300; // below this = SPA shell, not real content

export type RawFetchResult =
  | { status: "ok"; html: string }
  | { status: "error" };

export async function fetchRawHtml(
  url: string,
  network: INetworkService,
  logger?: any
): Promise<RawFetchResult> {
  const cached = rawCache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { status: "ok", html: cached.html };
  }

  try {
    const response = await network.fetch(url, {
      method: "GET",
      headers: { Accept: "text/html" },
      timeout: 15000,
    });

    if (!response.ok) {
      logger?.warn(`fetchRawHtml: ${response.status} for ${url}`);
      return { status: "error" };
    }

    const html = injectBase(response.body, url);
    rawCache.set(url, { html, timestamp: Date.now() });
    return { status: "ok", html };
  } catch (err: any) {
    logger?.error(`fetchRawHtml: error for ${url}: ${err?.message ?? err}`);
    return { status: "error" };
  }
}

function injectBase(rawHtml: string, pageUrl: string): string {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return rawHtml;
  }

  const baseTag = `<base href="${origin}/" target="_blank">`;

  // Replace existing <base> tag or inject after <head>
  if (/<base\b/i.test(rawHtml)) {
    return rawHtml.replace(/<base\b[^>]*>/i, baseTag);
  }
  if (/<head\b[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/(<head\b[^>]*>)/i, `$1${baseTag}`);
  }
  // No <head> tag — prepend
  return baseTag + rawHtml;
}

export type FetchResult =
  | { status: "ok"; html: string }
  | { status: "empty" }     // SPA / no extractable content — show URL card
  | { status: "error" };    // network failure — show URL card + notice

export async function fetchUrlContent(
  url: string,
  network: INetworkService,
  logger?: any
): Promise<FetchResult> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { status: "ok", html: cached.html };
  }

  try {
    const response = await network.fetch(url, {
      method: "GET",
      headers: { Accept: "text/html" },
      timeout: 15000,
    });

    if (!response.ok) {
      logger?.warn(`fetchUrlContent: ${response.status} for ${url}`);
      return { status: "error" };
    }

    const html = parsePageHtml(response.body, url);
    if (!html) {
      logger?.debug(`fetchUrlContent: no extractable content for ${url}`);
      return { status: "empty" };
    }

    cache.set(url, { html, timestamp: Date.now() });
    return { status: "ok", html };
  } catch (err: any) {
    logger?.error(`fetchUrlContent: error for ${url}: ${err?.message ?? err}`);
    return { status: "error" };
  }
}

function parsePageHtml(rawHtml: string, baseUrl: string): string | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  let main: Element | null = null;

  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el && (el.textContent?.trim().length ?? 0) > MIN_CONTENT_LENGTH) {
      main = el;
      break;
    }
  }

  // Last resort: stripped body
  if (!main) {
    const body = doc.body;
    body
      .querySelectorAll(
        "nav, header, footer, aside, script, style, noscript, iframe, [class*='nav'], [class*='menu'], [class*='sidebar'], [id*='nav'], [id*='menu'], [id*='sidebar']"
      )
      .forEach((el) => el.remove());
    if ((body.textContent?.trim().length ?? 0) > MIN_CONTENT_LENGTH) {
      main = body;
    }
  }

  if (!main) return null;

  // Clean noise from within selected content
  main
    .querySelectorAll("script, style, noscript, iframe")
    .forEach((el) => el.remove());

  // Fix relative URLs
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    origin = "";
  }

  if (origin) {
    main.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (href?.startsWith("/")) a.setAttribute("href", `${origin}${href}`);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });

    main.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src?.startsWith("/")) img.setAttribute("src", `${origin}${src}`);
    });
  }

  const content = main.innerHTML.trim();
  return content.length > MIN_CONTENT_LENGTH ? content : null;
}
