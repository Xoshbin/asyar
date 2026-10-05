import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  WORKER_FALLBACK_REMOVED_IN,
  workerBundleNeedsDomFallback,
  workerCompatWarning,
} from './workerCompat';

let dir: string;
const write = (name: string, body: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body);
  return p;
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-compat-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('workerBundleNeedsDomFallback', () => {
  // Minified excerpt of Vite 6's modulepreload polyfill. Verified against a
  // real `vite build` with `modulePreload: true`: the selector string below is
  // emitted verbatim, and is absent with `modulePreload: false`.
  it('detects the modulepreload polyfill', () => {
    const file = write(
      'polyfilled.js',
      '(function(){const e=document.createElement("link").relList;' +
        'if(e&&e.supports&&e.supports("modulepreload"))return;' +
        'for(const t of document.querySelectorAll(\'link[rel="modulepreload"]\'))r(t)})();',
    );
    expect(workerBundleNeedsDomFallback(file)).toBe(true);
  });

  it('accepts a clean worker bundle', () => {
    const file = write('clean.js', 'self.onmessage=(e)=>{self.postMessage(e.data)};');
    expect(workerBundleNeedsDomFallback(file)).toBe(false);
  });

  // Vite's `__vitePreload` helper touches the DOM too, but guards every access
  // with `typeof document !== "undefined"`, so it is safe inside a worker and
  // must not be reported. esbuild minifies that guard to `typeof document<"u"`.
  it('does not flag the guarded __vitePreload helper', () => {
    const file = write(
      'guarded.js',
      'const e=typeof document<"u"&&document.createElement("link").relList;' +
        'function r(t,n){return e&&e.supports&&e.supports("modulepreload")?"modulepreload":"preload"}',
    );
    expect(workerBundleNeedsDomFallback(file)).toBe(false);
  });

  it('does not flag a worker that merely feature-detects document', () => {
    const file = write('guarded-user.js', 'if(typeof document!=="undefined"){doBrowserThing()}');
    expect(workerBundleNeedsDomFallback(file)).toBe(false);
  });

  it('reports false for a missing file rather than throwing', () => {
    expect(workerBundleNeedsDomFallback(path.join(dir, 'nope.js'))).toBe(false);
  });
});

describe('workerCompatWarning', () => {
  it('names the file and the version that removes the fallback', () => {
    const msg = workerCompatWarning('dist/worker.js');
    expect(msg).toContain('dist/worker.js');
    expect(msg).toContain(WORKER_FALLBACK_REMOVED_IN);
    expect(msg).toContain('asyar-sdk/vite');
  });
});

describe('WORKER_FALLBACK_REMOVED_IN', () => {
  // The CLI's deadline and the launcher's guard must not drift apart; the
  // launcher enforces its own half in workerFallbackDeadline.test.ts.
  it('matches the launcher source marker when the launcher is checked out', () => {
    const workerHost = path.resolve(
      __dirname,
      '../../../asyar-launcher/src/services/extension/workerHost.svelte.ts',
    );
    if (!fs.existsSync(workerHost)) return; // published SDK tarball — nothing to compare
    const marker = fs.readFileSync(workerHost, 'utf-8').match(/remove in (\d+\.\d+\.\d+)/);
    expect(marker?.[1]).toBe(WORKER_FALLBACK_REMOVED_IN);
  });
});
