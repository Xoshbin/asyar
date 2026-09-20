import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  adaptRaycastPackageJson,
  type AsyarManifest,
  type RaycastPackageJson,
} from '../manifest/index.js';

export interface CompileRaycastOptions {
  /** Root directory of unpacked Raycast extension (must contain package.json) */
  sourceDir: string;
  /** Directory where Asyar-compatible extension files will be emitted (defaults to sourceDir) */
  outDir?: string;
  /** Optional ID prefix for Asyar manifest (defaults to 'org.asyar.raycast') */
  idPrefix?: string;
  /** Optional SDK version for manifest (defaults to '^4.11.0') */
  sdkVersion?: string;
  /** Whether to copy source code into outDir when outDir !== sourceDir (default: true) */
  copySource?: boolean;
  /** Optional directory of @asyar/raycast-compat package (auto-detected if omitted) */
  compatDir?: string;
}

/**
 * Traverses up from this module to locate the @asyar/raycast-compat package root.
 */
export function findSelfCompatDir(): string {
  try {
    const currentFile = fileURLToPath(import.meta.url);
    let cur = path.dirname(currentFile);
    while (cur !== path.dirname(cur)) {
      const pkgCandidate = path.join(cur, 'package.json');
      if (fs.existsSync(pkgCandidate)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgCandidate, 'utf-8'));
          if (pkg.name === '@asyar/raycast-compat') {
            return cur;
          }
        } catch {}
      }
      cur = path.dirname(cur);
    }
  } catch {}
  return '';
}

export interface CompileRaycastResult {
  manifest: AsyarManifest;
  viewCommands: string[];
  workerCommands: string[];
  filesCreated: string[];
}

/**
 * Resolves the relative module path for a Raycast command.
 */
export function resolveCommandSourceFile(sourceDir: string, commandName: string): string {
  const extensions = ['.tsx', '.ts', '.jsx', '.js'];
  for (const ext of extensions) {
    const candidate = path.join(sourceDir, 'src', `${commandName}${ext}`);
    if (fs.existsSync(candidate)) {
      return `./src/${commandName}`;
    }
  }

  // Nested directory format: src/<commandName>/index.{tsx,ts,jsx,js}
  for (const ext of extensions) {
    const candidate = path.join(sourceDir, 'src', commandName, `index${ext}`);
    if (fs.existsSync(candidate)) {
      return `./src/${commandName}/index`;
    }
  }

  // Root level format: <commandName>.{tsx,ts,jsx,js}
  for (const ext of extensions) {
    const candidate = path.join(sourceDir, `${commandName}${ext}`);
    if (fs.existsSync(candidate)) {
      return `./${commandName}`;
    }
  }

  return `./src/${commandName}`;
}

export * from './remote.js';

/**
 * Copies a directory recursively.
 */
function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Compiles/scaffolds an unpacked Raycast extension into an Asyar-runnable extension directory.
 */
export function compileRaycastExtension(options: CompileRaycastOptions): CompileRaycastResult {
  const sourceDir = path.resolve(options.sourceDir);
  const outDir = options.outDir ? path.resolve(options.outDir) : sourceDir;
  const pkgPath = path.join(sourceDir, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    throw new Error(`package.json not found in ${sourceDir}`);
  }

  const pkgContent = fs.readFileSync(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent) as RaycastPackageJson;

  const manifest = adaptRaycastPackageJson(pkg, {
    idPrefix: options.idPrefix,
    sdkVersion: options.sdkVersion,
  });

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const filesCreated: string[] = [];

  // Write manifest.json
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  filesCreated.push(manifestPath);

  // Categorize commands
  const viewCommands: Array<{ name: string; file: string }> = [];
  const workerCommands: Array<{ name: string; file: string }> = [];

  const rawCommands = pkg.commands || [];

  for (const cmd of rawCommands) {
    const found = resolveCommandSourceFile(sourceDir, cmd.name);
    if (cmd.mode === 'view') {
      viewCommands.push({ name: cmd.name, file: found });
    } else {
      workerCommands.push({ name: cmd.name, file: found });
    }
  }

  // Generate view files if view commands exist
  if (viewCommands.length > 0) {
    const viewHtmlContent = generateViewHtml(manifest.name);
    const viewHtmlPath = path.join(outDir, 'view.html');
    fs.writeFileSync(viewHtmlPath, viewHtmlContent, 'utf-8');
    filesCreated.push(viewHtmlPath);

    const viewTsxContent = generateViewEntry(viewCommands);
    const viewTsxPath = path.join(outDir, 'view.tsx');
    fs.writeFileSync(viewTsxPath, viewTsxContent, 'utf-8');
    filesCreated.push(viewTsxPath);
  }

  // Generate worker files if worker commands or background exist
  if (workerCommands.length > 0 || manifest.background) {
    const workerHtmlContent = generateWorkerHtml(manifest.name);
    const workerHtmlPath = path.join(outDir, 'worker.html');
    fs.writeFileSync(workerHtmlPath, workerHtmlContent, 'utf-8');
    filesCreated.push(workerHtmlPath);

    const workerTsContent = generateWorkerEntry(workerCommands);
    const workerTsPath = path.join(outDir, 'worker.ts');
    fs.writeFileSync(workerTsPath, workerTsContent, 'utf-8');
    filesCreated.push(workerTsPath);
  }

  // Generate vite.config.ts
  const compatDir = options.compatDir || findSelfCompatDir();
  const viteConfigContent = generateViteConfig({
    hasView: viewCommands.length > 0,
    hasWorker: workerCommands.length > 0 || !!manifest.background,
    compatDir,
  });
  const viteConfigPath = path.join(outDir, 'vite.config.ts');
  fs.writeFileSync(viteConfigPath, viteConfigContent, 'utf-8');
  filesCreated.push(viteConfigPath);

  // Copy assets and sources if outDir is distinct
  if (outDir !== sourceDir) {
    if (options.copySource !== false) {
      const srcDir = path.join(sourceDir, 'src');
      const targetSrcDir = path.join(outDir, 'src');
      if (fs.existsSync(srcDir)) {
        copyDirRecursive(srcDir, targetSrcDir);
      }
    }

    const assetsDir = path.join(sourceDir, 'assets');
    const targetAssetsDir = path.join(outDir, 'assets');
    if (fs.existsSync(assetsDir)) {
      copyDirRecursive(assetsDir, targetAssetsDir);
    }

    if (pkg.icon) {
      const iconPath = path.join(sourceDir, pkg.icon);
      if (fs.existsSync(iconPath)) {
        const destIconPath = path.join(outDir, pkg.icon);
        const destDir = path.dirname(destIconPath);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(iconPath, destIconPath);

        const distDir = path.join(outDir, 'dist');
        if (fs.existsSync(distDir)) {
          fs.copyFileSync(iconPath, path.join(distDir, path.basename(pkg.icon)));
        }
      }
    }
  }

  return {
    manifest,
    viewCommands: viewCommands.map((c) => c.name),
    workerCommands: workerCommands.map((c) => c.name),
    filesCreated,
  };
}

function generateViewEntry(commands: Array<{ name: string; file: string }>): string {
  const imports = commands.map((cmd, i) => `import * as Mod_${i} from '${cmd.file}';`).join('\n');
  const unwrap = commands
    .map((cmd, i) => `const Cmd_${i} = (Mod_${i} as any).default ?? Mod_${i};`)
    .join('\n');
  const mapEntries = commands.map((cmd, i) => `  '${cmd.name}': Cmd_${i},`).join('\n');

  return `import { mountRaycastView } from '@asyar/raycast-compat/runner';
${imports}

${unwrap}

mountRaycastView({
${mapEntries}
});
`;
}

function generateWorkerEntry(commands: Array<{ name: string; file: string }>): string {
  const imports = commands
    .map((cmd, i) => `import * as WorkerMod_${i} from '${cmd.file}';`)
    .join('\n');
  const unwrap = commands
    .map((cmd, i) => `const WorkerCmd_${i} = (WorkerMod_${i} as any).default ?? WorkerMod_${i};`)
    .join('\n');
  const mapEntries = commands.map((cmd, i) => `  '${cmd.name}': WorkerCmd_${i},`).join('\n');

  return `import { startWorkerRunner } from '@asyar/raycast-compat/runner';
import manifest from './manifest.json';
${imports}

${unwrap}

startWorkerRunner({
  manifest,
  commands: {
${mapEntries}
  },
});
`;
}

function generateViewHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      html, body, #root {
        height: 100%;
        margin: 0;
        padding: 0;
        overflow: hidden;
        box-sizing: border-box;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./view.tsx"></script>
  </body>
</html>
`;
}

function generateWorkerHtml(title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title} (worker)</title>
  </head>
  <body>
    <script type="module" src="./worker.ts"></script>
  </body>
</html>
`;
}

function generateViteConfig(opts: {
  hasView: boolean;
  hasWorker: boolean;
  compatDir?: string;
}): string {
  const inputs: string[] = [];
  if (opts.hasView) {
    inputs.push("        view: resolve(__dirname, 'view.html'),");
  }
  if (opts.hasWorker) {
    inputs.push("        worker: resolve(__dirname, 'worker.html'),");
  }

  const knownCompatDir = opts.compatDir ? JSON.stringify(opts.compatDir) : "''";

  return `import { defineConfig } from 'vite';
import { resolve } from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const knownCompatDir = ${knownCompatDir};
let compatDir = '';

if (knownCompatDir && fs.existsSync(knownCompatDir)) {
  compatDir = knownCompatDir;
} else {
  try {
    compatDir = resolve(require.resolve('@asyar/raycast-compat/package.json'), '..');
  } catch {
    let cur = __dirname;
    while (cur !== resolve(cur, '..')) {
      const candidatePkg = resolve(cur, 'packages/raycast-compat');
      if (fs.existsSync(candidatePkg)) {
        compatDir = candidatePkg;
        break;
      }
      const candidateNm = resolve(cur, 'node_modules/@asyar/raycast-compat');
      if (fs.existsSync(candidateNm)) {
        compatDir = candidateNm;
        break;
      }
      cur = resolve(cur, '..');
    }
    if (!compatDir) {
      compatDir = resolve(__dirname, '../../packages/raycast-compat');
    }
  }
}

const resolveCompat = (id: string) => {
  try {
    return require.resolve(id, { paths: [compatDir, __dirname, process.cwd()] });
  } catch {
    return id;
  }
};

export default defineConfig({
  base: './',
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@raycast/api': resolve(compatDir, 'src/index.ts'),
      '@raycast/utils': resolve(compatDir, 'src/utils/index.ts'),
      '@asyar/raycast-compat/runner': resolve(compatDir, 'src/runner/index.ts'),
      '@asyar/raycast-compat/utils': resolve(compatDir, 'src/utils/index.ts'),
      '@asyar/raycast-compat': resolve(compatDir, 'src/index.ts'),
      'react/jsx-runtime': resolveCompat('react/jsx-runtime'),
      'react/jsx-dev-runtime': resolveCompat('react/jsx-dev-runtime'),
      'react-dom/client': resolveCompat('react-dom/client'),
      'react-dom': resolveCompat('react-dom'),
      'react': resolveCompat('react'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
${inputs.join('\n')}
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
`;
}
