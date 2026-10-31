import * as fs from 'fs';
import * as path from 'path';

/**
 * The README is shipped inside the package and rendered by the Store
 * (asyar.org and the launcher), where relative paths like `docs/shot.png`
 * point nowhere. Like `vsce` does for VS Code, rewrite them at publish to
 * absolute GitHub URLs pinned to the release tag: images to the raw file,
 * links to the file view. Code blocks and inline code are left alone.
 */

export interface ReadmeLinkTarget {
  owner: string;
  repo: string;
  /** The release tag, so every link shows the files of this version. */
  ref: string;
}

export interface ReadmeRewriteResult {
  markdown: string;
  /** Repo-relative paths of the images that were rewritten, de-duplicated. */
  relativeImages: string[];
}

type LinkKind = 'image' | 'link';

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico)$/i;
const FENCED_BLOCK = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /(`+)[^\n]*?\1/g;
const MD_IMAGE = /!\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g;
// Link text may itself contain an image (`[![badge](...)](...)`).
const MD_LINK = /(?<!!)\[((?:[^[\]]|!\[[^\]]*\]\([^)]*\))*)\]\(\s*([^)\s]+)((?:\s+"[^"]*")?)\s*\)/g;
const HTML_IMG_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi;
const HTML_A_HREF = /(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi;
const REFERENCE_DEFINITION = /^( {0,3}\[[^\]]+\]:[ \t]*)(<?)([^\s>]+)(>?)/gm;

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

export function rewriteReadmeLinks(
  markdown: string,
  target: ReadmeLinkTarget,
): ReadmeRewriteResult {
  const base = `${target.owner}/${target.repo}`;
  const relativeImages: string[] = [];

  /** Absolute URL for a repo-relative target, or null to leave it as is. */
  const resolve = (raw: string, kind: LinkKind): string | null => {
    if (!raw || raw.startsWith('#') || raw.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      return null;
    }
    const suffixAt = raw.search(/[?#]/);
    const suffix = suffixAt === -1 ? '' : raw.slice(suffixAt);
    let repoPath = safeDecode(suffixAt === -1 ? raw : raw.slice(0, suffixAt));
    while (repoPath.startsWith('./')) repoPath = repoPath.slice(2);
    repoPath = repoPath.replace(/^\/+/, '');
    // `../` leaves the repo; there is nothing on GitHub to point at.
    if (!repoPath || repoPath.startsWith('../')) return null;

    if (kind === 'image' && !relativeImages.includes(repoPath)) relativeImages.push(repoPath);
    const host =
      kind === 'image'
        ? `https://raw.githubusercontent.com/${base}/${target.ref}`
        : `https://github.com/${base}/blob/${target.ref}`;
    return `${host}/${encodeURI(repoPath)}${suffix}`;
  };

  // Park code behind placeholders so examples in it are never rewritten.
  const parked: string[] = [];
  const park = (code: string) => `\u0000${parked.push(code) - 1}\u0000`;
  let text = markdown.replace(FENCED_BLOCK, park).replace(INLINE_CODE, park);

  text = text
    .replace(MD_IMAGE, (whole, alt: string, url: string, title: string) => {
      const resolved = resolve(url, 'image');
      return resolved ? `![${alt}](${resolved}${title})` : whole;
    })
    .replace(MD_LINK, (whole, label: string, url: string, title: string) => {
      const resolved = resolve(url, 'link');
      return resolved ? `[${label}](${resolved}${title})` : whole;
    })
    .replace(HTML_IMG_SRC, (whole, head: string, quote: string, url: string) => {
      const resolved = resolve(url, 'image');
      return resolved ? `${head}${quote}${resolved}${quote}` : whole;
    })
    .replace(HTML_A_HREF, (whole, head: string, quote: string, url: string) => {
      const resolved = resolve(url, 'link');
      return resolved ? `${head}${quote}${resolved}${quote}` : whole;
    })
    .replace(
      REFERENCE_DEFINITION,
      (whole, head: string, open: string, url: string, close: string) => {
        const kind: LinkKind = IMAGE_EXTENSION.test(url.split(/[?#]/)[0]) ? 'image' : 'link';
        const resolved = resolve(url, kind);
        return resolved ? `${head}${open}${resolved}${close}` : whole;
      },
    );

  text = text.replace(/\u0000(\d+)\u0000/g, (_, index: string) => parked[Number(index)]);
  return { markdown: text, relativeImages };
}

/** The repo-relative paths that do not exist under `cwd`. */
export function findMissingFiles(cwd: string, repoPaths: string[]): string[] {
  return repoPaths.filter((repoPath) => !fs.existsSync(path.join(cwd, repoPath)));
}
