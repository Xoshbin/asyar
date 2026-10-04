import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../../asyar-launcher/package.json', import.meta.url));
// Vite exposes esbuild transforms; its installed dependency resolves the bundler.
const viteRequire = createRequire(require.resolve('vite'));
const esbuild = viteRequire('esbuild');
const root = fileURLToPath(new URL('.', import.meta.url));
for (const [entry, outfile] of [
  ['worker', 'dist/daemon/main.js'],
  ['view', 'dist/view.js'],
]) {
  await esbuild.build({
    entryPoints: [root + `src/${entry}.ts`],
    outfile: root + outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
}
mkdirSync(root + 'dist', { recursive: true });
writeFileSync(
  root + 'dist/view.html',
  '<!doctype html><html><body><h1>Worker runtime status</h1><pre>Connecting…</pre><script type="module" src="./view.js"></script></body></html>',
);
