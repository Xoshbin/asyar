/** Node-only build helper. Import from asyar-sdk/vite, never from a runtime entry. */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mergeConfig, type UserConfig } from 'vite';

export interface ExtensionConfigOptions {
  /** Extension directory; pass fileURLToPath(new URL('.', import.meta.url)). */
  root?: string;
  worker?: string | false;
  view?: string | false;
  /** Use the local Raycast adapter, or provide its directory explicitly. */
  raycastCompat?: boolean | string;
  /** Optional workspace SDK source directory for hot reload. */
  sdkSource?: string;
  /** Plugins and extension-specific Vite options. Build entry policy stays shared. */
  config?: UserConfig;
}

export function defineExtensionConfig(options: ExtensionConfigOptions = {}): UserConfig {
  const root = resolve(options.root ?? process.cwd());
  const input: Record<string, string> = {};
  for (const role of ['worker', 'view'] as const) {
    const entry = options[role] ?? `${role}.html`;
    if (entry !== false && existsSync(resolve(root, entry))) input[role] = resolve(root, entry);
    else if (typeof options[role] === 'string') throw new Error(`Missing ${role} entry: ${entry}`);
  }
  if (!Object.keys(input).length)
    throw new Error('Extension needs a worker.html or view.html entry');

  const alias: Record<string, string> = {};
  const sdkSource = options.sdkSource ?? resolve(root, '../../asyar-sdk/src');
  const subpaths = ['contracts', 'worker', 'view'] as const;
  if (subpaths.every((subpath) => existsSync(resolve(sdkSource, `${subpath}.ts`)))) {
    for (const subpath of subpaths)
      alias[`asyar-sdk/${subpath}`] = resolve(sdkSource, `${subpath}.ts`);
  }

  if (options.raycastCompat) {
    const require = createRequire(resolve(root, 'package.json'));
    let compatDir: string;
    if (typeof options.raycastCompat === 'string') compatDir = resolve(root, options.raycastCompat);
    else {
      try {
        compatDir = dirname(require.resolve('@asyar/raycast-compat/package.json'));
      } catch {
        compatDir = resolve(root, '../../packages/raycast-compat');
      }
    }
    if (!existsSync(resolve(compatDir, 'src/index.ts')))
      throw new Error(`Raycast adapter not found: ${compatDir}`);
    Object.assign(alias, {
      '@raycast/api': resolve(compatDir, 'src/index.ts'),
      '@raycast/utils': resolve(compatDir, 'src/utils/index.ts'),
      '@asyar/raycast-compat/runner': resolve(compatDir, 'src/runner/index.ts'),
      '@asyar/raycast-compat/utils': resolve(compatDir, 'src/utils/index.ts'),
      '@asyar/raycast-compat': resolve(compatDir, 'src/index.ts'),
    });
    for (const id of [
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'react-dom',
      'react',
    ]) {
      alias[id] = require.resolve(id, { paths: [compatDir, root] });
    }
  }

  const config = mergeConfig(
    {
      root,
      resolve: { alias },
      ...(options.raycastCompat ? { esbuild: { jsx: 'automatic' } } : {}),
    },
    options.config ?? {},
  );
  // HTML entries inject a DOM-dependent modulepreload polyfill by default.
  // Neither worker execution nor small, on-demand view iframes need preload hints.
  config.base = './';
  config.root = root;
  config.build = {
    ...config.build,
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    modulePreload: false,
    rollupOptions: {
      ...config.build?.rollupOptions,
      input,
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  };
  return config;
}
