/** @vitest-environment node */
import { mkdtempSync, writeFileSync, rmSync, realpathSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { build, transformWithEsbuild, type UserConfig } from 'vite';
import { runInNewContext } from 'node:vm';
import { posix } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { defineExtensionConfig } from './vite';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(resolve(tmpdir(), 'asyar-worker-bundle-')));
  roots.push(root);
  for (const role of ['worker', 'view']) {
    writeFileSync(
      resolve(root, `${role}.html`),
      `<script type="module" src="./${role}.js"></script>`,
    );
    writeFileSync(
      resolve(root, `${role}.js`),
      `import { value, lazy } from './shared.js'; globalThis.${role}Value = value; globalThis.${role}Lazy = lazy;`,
    );
  }
  writeFileSync(
    resolve(root, 'shared.js'),
    'export const value = 42; export const lazy = () => import("./lazy.js");',
  );
  writeFileSync(resolve(root, 'lazy.js'), 'export const later = 7;');
  return root;
}
async function chunks(config: UserConfig) {
  const result = await build({
    ...config,
    configFile: false,
    logLevel: 'silent',
    build: { ...config.build, write: false },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one Rollup output');
  return result.output.filter((chunk) => chunk.type === 'chunk');
}
async function evaluateWorkerGraph(output: Awaited<ReturnType<typeof chunks>>) {
  const byName = new Map(output.map((chunk) => [chunk.fileName, chunk]));
  const transformed = new Map<string, string>();
  const visited = new Set<string>();
  async function inspect(name: string): Promise<void> {
    if (visited.has(name)) return;
    visited.add(name);
    const chunk = byName.get(name);
    if (!chunk) throw new Error(`Missing imported chunk: ${name}`);
    transformed.set(
      name,
      (await transformWithEsbuild(chunk.code, name, { format: 'cjs', target: 'es2020' })).code,
    );
    for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) await inspect(dependency);
  }
  await inspect('worker.js');
  const cache = new Map<string, { exports: unknown }>();
  function evaluate(name: string): unknown {
    const cached = cache.get(name);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(name, module);
    // Evaluate actual emitted code without document/window. DOM references inside
    // uncalled functions and typeof guards are valid in a headless worker.
    runInNewContext(
      transformed.get(name)!,
      {
        module,
        exports: module.exports,
        require: (dependency: string) =>
          evaluate(posix.normalize(posix.join(posix.dirname(name), dependency))),
      },
      { filename: name, timeout: 1000 },
    );
    return module.exports;
  }
  for (const name of visited) evaluate(name);
  return visited;
}
it('reproduces the injected DOM polyfill with the old HTML build defaults', async () => {
  const root = fixture();
  const output = await chunks({
    root,
    build: {
      rollupOptions: {
        input: { worker: resolve(root, 'worker.html'), view: resolve(root, 'view.html') },
        output: { entryFileNames: '[name].js' },
      },
    },
  });
  expect(output.some((chunk) => chunk.code.includes('document.createElement'))).toBe(true);
  await expect(evaluateWorkerGraph(output)).rejects.toThrow('document is not defined');
});
it('builds a worker and all imported chunks without DOM at module evaluation', async () => {
  const root = fixture();
  const output = await chunks(defineExtensionConfig({ root }));
  const visited = await evaluateWorkerGraph(output);
  expect(visited.size).toBeGreaterThan(1);
  expect(output.some((chunk) => chunk.fileName === 'view.js')).toBe(true);
});
it('owns relative base, deterministic entries and preload policy even with custom options', () => {
  const root = fixture();
  const config = defineExtensionConfig({
    root,
    config: { base: '/', build: { modulePreload: true, sourcemap: true } },
  });
  expect(config.base).toBe('./');
  expect(config.build?.modulePreload).toBe(false);
  expect(config.build?.sourcemap).toBe(true);
});
it('supports worker-only and view-only extensions', () => {
  const root = fixture();
  expect(defineExtensionConfig({ root, view: false }).build?.rollupOptions?.input).toEqual({
    worker: resolve(root, 'worker.html'),
  });
  expect(defineExtensionConfig({ root, worker: false }).build?.rollupOptions?.input).toEqual({
    view: resolve(root, 'view.html'),
  });
});

it('resolves Raycast aliases through the same build policy', () => {
  const root = fixture();
  const adapter = resolve(root, 'adapter');
  mkdirSync(resolve(adapter, 'src/runner'), { recursive: true });
  mkdirSync(resolve(adapter, 'src/utils'), { recursive: true });
  for (const name of ['index.ts', 'runner/index.ts', 'utils/index.ts'])
    writeFileSync(resolve(adapter, 'src', name), 'export {};');
  for (const pkg of ['react', 'react-dom']) {
    const dir = resolve(root, 'node_modules', pkg);
    mkdirSync(dir, { recursive: true });
    for (const name of ['index.js', 'jsx-runtime.js', 'jsx-dev-runtime.js', 'client.js'])
      writeFileSync(resolve(dir, name), '');
  }
  const config = defineExtensionConfig({ root, raycastCompat: adapter });
  expect(config.resolve?.alias).toMatchObject({
    '@raycast/api': resolve(adapter, 'src/index.ts'),
    '@asyar/raycast-compat/runner': resolve(adapter, 'src/runner/index.ts'),
    react: resolve(root, 'node_modules/react/index.js'),
  });
  expect(config.esbuild).toMatchObject({ jsx: 'automatic' });
  expect(config.build?.modulePreload).toBe(false);
});
