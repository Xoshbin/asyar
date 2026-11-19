/** Node-only build helper. Import from asyar-sdk/vite, never from a runtime entry. */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, posix } from 'node:path';
import { mergeConfig, type Plugin, type UserConfig } from 'vite';

const DEFAULT_VIEW_TITLE = 'Asyar Extension View';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveExtensionTitle(root: string): string {
  const manifestPath = resolve(root, 'manifest.json');
  if (!existsSync(manifestPath)) return DEFAULT_VIEW_TITLE;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: unknown };
    if (typeof parsed?.name === 'string' && parsed.name.trim().length > 0) {
      return escapeHtml(parsed.name.trim());
    }
  } catch {
    // Fall back to default title if manifest.json is unreadable or invalid JSON.
  }
  return DEFAULT_VIEW_TITLE;
}

const WORKER_CANDIDATES = [
  'worker.html',
  'src/worker.ts',
  'src/worker.js',
  'src/index.worker.ts',
  'src/main.worker.ts',
] as const;

const VIEW_CANDIDATES = [
  'view.html',
  'src/view.ts',
  'src/view.tsx',
  'src/view.js',
  'src/view.jsx',
  'src/index.ts',
  'src/index.tsx',
] as const;

function asyarVirtualHtmlPlugin(root: string, viewScriptPath: string): Plugin {
  const title = resolveExtensionTitle(root);
  return {
    name: 'asyar:virtual-html',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];
        if (url === '/' || url === '/view.html') {
          const relPath =
            '/' + posix.relative(root.replace(/\\/g, '/'), viewScriptPath.replace(/\\/g, '/'));
          const rawHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${relPath}"></script>
  </body>
</html>\n`;
          try {
            const html = await server.transformIndexHtml(req.url ?? '/', rawHtml);
            res.setHeader('Content-Type', 'text/html');
            res.end(html);
          } catch (err) {
            next(err);
          }
          return;
        }
        next();
      });
    },
    generateBundle: {
      order: 'post',
      handler(_opts, bundle) {
        if (bundle['view.html']) return;

        const cssAssets = Object.keys(bundle).filter((file) => file.endsWith('.css'));
        const headLines = [
          '    <meta charset="UTF-8" />',
          '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
          `    <title>${title}</title>`,
          ...cssAssets.map((css) => `    <link rel="stylesheet" href="./${css}">`),
        ];

        const html = `<!DOCTYPE html>
<html lang="en">
  <head>
${headLines.join('\n')}
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./view.js"></script>
  </body>
</html>\n`;

        this.emitFile({
          type: 'asset',
          fileName: 'view.html',
          source: html,
        });
      },
    },
  };
}

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
  let needsVirtualHtml = false;
  let resolvedViewPath: string | undefined;

  if (options.worker !== false) {
    if (typeof options.worker === 'string') {
      const p = resolve(root, options.worker);
      if (existsSync(p)) input.worker = p;
      else throw new Error(`Missing worker entry: ${options.worker}`);
    } else {
      const candidate = WORKER_CANDIDATES.find((c) => existsSync(resolve(root, c)));
      if (candidate) input.worker = resolve(root, candidate);
    }
  }

  if (options.view !== false) {
    if (typeof options.view === 'string') {
      const p = resolve(root, options.view);
      if (existsSync(p)) {
        input.view = p;
        resolvedViewPath = p;
        if (!options.view.endsWith('.html')) needsVirtualHtml = true;
      } else {
        throw new Error(`Missing view entry: ${options.view}`);
      }
    } else {
      const candidate = VIEW_CANDIDATES.find((c) => existsSync(resolve(root, c)));
      if (candidate) {
        input.view = resolve(root, candidate);
        resolvedViewPath = input.view;
        if (!candidate.endsWith('.html')) needsVirtualHtml = true;
      }
    }
  }

  if (!Object.keys(input).length)
    throw new Error('Extension needs a worker or view entry (e.g. src/worker.ts or src/view.ts)');

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
      plugins:
        needsVirtualHtml && resolvedViewPath
          ? [asyarVirtualHtmlPlugin(root, resolvedViewPath)]
          : [],
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
