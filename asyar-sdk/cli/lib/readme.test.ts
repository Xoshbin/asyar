import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { rewriteReadmeLinks, findMissingFiles } from './readme';

const OPTS = { owner: 'acme', repo: 'asyar-timer-extension', ref: 'v1.2.0' };
const RAW = 'https://raw.githubusercontent.com/acme/asyar-timer-extension/v1.2.0';
const BLOB = 'https://github.com/acme/asyar-timer-extension/blob/v1.2.0';

function rewrite(markdown: string): string {
  return rewriteReadmeLinks(markdown, OPTS).markdown;
}

describe('rewriteReadmeLinks', () => {
  it('pins a relative image to the release tag on GitHub', () => {
    expect(rewrite('![Needs you](docs/needs-you.png)')).toBe(
      `![Needs you](${RAW}/docs/needs-you.png)`,
    );
  });

  it('treats ./ and leading / as the repo root', () => {
    expect(rewrite('![a](./docs/a.png) ![b](/docs/b.png)')).toBe(
      `![a](${RAW}/docs/a.png) ![b](${RAW}/docs/b.png)`,
    );
  });

  it('keeps an image title', () => {
    expect(rewrite('![a](docs/a.png "The list")')).toBe(`![a](${RAW}/docs/a.png "The list")`);
  });

  it('points relative links at the file view, keeping the fragment', () => {
    expect(rewrite('See [setup](docs/GUIDE.md#setup).')).toBe(
      `See [setup](${BLOB}/docs/GUIDE.md#setup).`,
    );
  });

  it('leaves absolute URLs, protocol-relative URLs, mailto and anchors alone', () => {
    const markdown =
      '![b](https://img.shields.io/x.svg) ![c](//cdn.example.com/c.png) ' +
      '[mail](mailto:me@example.com) [usage](#usage)';
    expect(rewrite(markdown)).toBe(markdown);
  });

  it('rewrites an image nested inside a link', () => {
    expect(rewrite('[![demo](docs/demo.gif)](docs/DEMO.md)')).toBe(
      `[![demo](${RAW}/docs/demo.gif)](${BLOB}/docs/DEMO.md)`,
    );
  });

  it('rewrites HTML img src and a href', () => {
    expect(rewrite('<img src="docs/a.png" width="300"> <a href="LICENSE">MIT</a>')).toBe(
      `<img src="${RAW}/docs/a.png" width="300"> <a href="${BLOB}/LICENSE">MIT</a>`,
    );
  });

  it('rewrites reference definitions, choosing raw for images', () => {
    expect(rewrite('[shot]: docs/a.png\n[lic]: LICENSE "License"')).toBe(
      `[shot]: ${RAW}/docs/a.png\n[lic]: ${BLOB}/LICENSE "License"`,
    );
  });

  it('does not touch fenced code blocks or inline code', () => {
    const markdown = '```md\n![a](docs/a.png)\n```\nUse `![x](x.png)` like this.';
    expect(rewrite(markdown)).toBe(markdown);
  });

  it('encodes spaces in paths', () => {
    expect(rewrite('<img src="docs/my shot.png">')).toBe(`<img src="${RAW}/docs/my%20shot.png">`);
  });

  it('reports every relative image it rewrote, once each', () => {
    const { relativeImages } = rewriteReadmeLinks(
      '![a](docs/a.png) ![again](./docs/a.png) <img src="b.gif"> ![c](https://x.io/c.png) [l](LICENSE)',
      OPTS,
    );
    expect(relativeImages).toEqual(['docs/a.png', 'b.gif']);
  });
});

describe('findMissingFiles', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-readme-test-'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'docs', 'a.png'), '');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns only the paths that do not exist in the project', () => {
    expect(findMissingFiles(dir, ['docs/a.png', 'docs/missing.png'])).toEqual(['docs/missing.png']);
  });
});
