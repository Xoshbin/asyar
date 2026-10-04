/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, transformWithEsbuild } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const written = new Map<string, string>();
let sdkExposesVite = true;

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: (_program: string, args: string[] = []) => ({
      on: () => {},
      stdout: { on: () => {} },
      stderr: { on: () => {} },
      execute: async () => {
        if (args.join(' ') === 'view asyar-sdk version') return { code: 0, stdout: '4.13.0\n' };
        if (args.join(' ') === 'view asyar-sdk exports --json')
          return { code: 0, stdout: JSON.stringify(sdkExposesVite ? { './vite': {} } : {}) };
        return { code: 1, stdout: '' }; // pnpm install/build + IDE launch: not under test
      },
    }),
  },
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: async () => {} }));
vi.mock('../../services/log/logService', () => ({
  logService: { debug: () => {}, error: () => {} },
}));
vi.mock('../../lib/ipc/commands', () => ({
  writeTextFileAbsolute: async (path: string, content: string) => void written.set(path, content),
  mkdirAbsolute: async () => {},
  checkPathExists: async () => false,
  registerDevExtension: async () => true,
}));

import { generateExtension, type ExtensionType } from './scaffoldService';

const launcherRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dirs: string[] = [];

/**
 * Evaluates the emitted worker chunk graph in a context with no `document` or
 * `window`, like a Web Worker. References inside uncalled functions and
 * `typeof document` guards are fine; Vite's modulepreload polyfill is not.
 */
async function evaluateWithoutDom(
  chunks: Map<string, { code: string; imports: string[]; dynamicImports: string[] }>,
  entry: string,
) {
  const transformed = new Map<string, string>();
  const visit = async (name: string): Promise<void> => {
    if (transformed.has(name)) return;
    const chunk = chunks.get(name);
    if (!chunk) throw new Error(`Missing imported chunk: ${name}`);
    transformed.set(name, '');
    transformed.set(
      name,
      (await transformWithEsbuild(chunk.code, name, { format: 'cjs', target: 'es2020' })).code,
    );
    for (const dep of [...chunk.imports, ...chunk.dynamicImports]) await visit(dep);
  };
  await visit(entry);
  const cache = new Map<string, { exports: unknown }>();
  const evaluate = (name: string): unknown => {
    const cached = cache.get(name);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(name, module);
    runInNewContext(
      transformed.get(name)!,
      {
        module,
        exports: module.exports,
        console,
        __ASYAR_ROLE__: 'worker', // set by the host; asyar-sdk/worker refuses to load without it
        require: (dep: string) => evaluate(posix.normalize(posix.join(posix.dirname(name), dep))),
      },
      { filename: name, timeout: 1000 },
    );
    return module.exports;
  };
  for (const name of transformed.keys()) evaluate(name);
}

async function scaffold(extensionType: ExtensionType, location: string) {
  written.clear();
  await generateExtension({
    name: 'Probe',
    id: 'com.example.probe',
    description: 'probe',
    location,
    extensionType,
    onProgress: () => {},
  });
  return new Map([...written].map(([path, content]) => [path.slice(location.length + 1), content]));
}

beforeEach(() => {
  sdkExposesVite = true;
});
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('scaffolded vite.config.ts', () => {
  it('routes through defineExtensionConfig when the published SDK exposes ./vite', async () => {
    const files = await scaffold('logic', '/virtual/ext');
    expect(files.get('vite.config.ts')).toContain("from 'asyar-sdk/vite'");
    expect(files.get('vite.config.ts')).toContain('defineExtensionConfig(');
  });

  it('falls back to a hand-rolled config that disables modulepreload when it does not', async () => {
    sdkExposesVite = false;
    const config = (await scaffold('logic', '/virtual/ext')).get('vite.config.ts')!;
    expect(config).not.toContain("from 'asyar-sdk/vite'");
    expect(config).toContain('modulePreload: false');
  });

  it('does not emit a vite config for themes', async () => {
    expect((await scaffold('theme', '/virtual/ext')).has('vite.config.ts')).toBe(false);
  });

  // The invariant from asyar-sdk/src/vite.test.ts, applied to what users actually get:
  // a worker entry must not pull in Vite's DOM-dependent modulepreload polyfill.
  it.each([['logic'], ['result']] as const)(
    'builds a %s extension whose worker graph evaluates without document/window',
    async (type) => {
      const root = mkdtempSync(resolve(launcherRoot, '.scaffold-build-'));
      dirs.push(root);
      const files = await scaffold(type, root);
      for (const [rel, content] of files) {
        mkdirSync(dirname(resolve(root, rel)), { recursive: true });
        // initializeExtensions() kicks off async host-protocol work that needs a real
        // worker scope; this test only covers synchronous module evaluation.
        writeFileSync(
          resolve(root, rel),
          content.replace('extensionBridge.initializeExtensions();', ''),
        );
      }
      const result = await build({
        root,
        configFile: resolve(root, 'vite.config.ts'),
        logLevel: 'silent',
        build: { write: false },
      });
      if (Array.isArray(result) || !('output' in result)) throw new Error('Expected one output');
      const chunks = new Map(
        result.output.flatMap((o) => (o.type === 'chunk' ? [[o.fileName, o] as const] : [])),
      );
      expect(chunks.has('worker.js')).toBe(true);
      await evaluateWithoutDom(chunks, 'worker.js');
    },
    60_000,
  );
});
