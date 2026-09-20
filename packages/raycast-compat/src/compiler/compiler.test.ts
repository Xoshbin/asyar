import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { compileRaycastExtension, resolveCommandSourceFile } from './index';

describe('Raycast Extension Compiler', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'raycast-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('resolveCommandSourceFile', () => {
    it('finds .tsx in src/', () => {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'search.tsx'), 'export default () => null;');

      const result = resolveCommandSourceFile(tmpDir, 'search');
      expect(result).toBe('./src/search');
    });

    it('finds nested index.ts in src/<cmd>/', () => {
      const cmdDir = path.join(tmpDir, 'src', 'browse');
      fs.mkdirSync(cmdDir, { recursive: true });
      fs.writeFileSync(path.join(cmdDir, 'index.ts'), 'export default () => null;');

      const result = resolveCommandSourceFile(tmpDir, 'browse');
      expect(result).toBe('./src/browse/index');
    });

    it('falls back to default ./src/<cmd> when file does not yet exist', () => {
      const result = resolveCommandSourceFile(tmpDir, 'missing');
      expect(result).toBe('./src/missing');
    });
  });

  describe('compileRaycastExtension', () => {
    it('compiles a dual view & background Raycast extension', () => {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const pkg = {
        name: 'lorem-tools',
        title: 'Lorem Tools',
        version: '1.0.1',
        description: 'Generate lorem ipsum and stats',
        commands: [
          {
            name: 'view-lorem',
            title: 'View Lorem Ipsum',
            mode: 'view',
          },
          {
            name: 'quick-copy',
            title: 'Quick Copy Lorem',
            mode: 'no-view',
          },
        ],
      };

      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));
      fs.writeFileSync(
        path.join(srcDir, 'view-lorem.tsx'),
        'export default function() { return null; }',
      );
      fs.writeFileSync(path.join(srcDir, 'quick-copy.ts'), 'export default async function() {}');

      const outDir = path.join(tmpDir, 'out');
      const result = compileRaycastExtension({
        sourceDir: tmpDir,
        outDir,
      });

      expect(result.manifest.id).toBe('org.asyar.raycast.lorem-tools');
      expect(result.manifest.name).toBe('Lorem Tools');
      expect(result.viewCommands).toEqual(['view-lorem']);
      expect(result.workerCommands).toEqual(['quick-copy']);

      // Check generated files
      expect(fs.existsSync(path.join(outDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'view.html'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'view.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'worker.html'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'worker.ts'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'vite.config.ts'))).toBe(true);

      const viewTsx = fs.readFileSync(path.join(outDir, 'view.tsx'), 'utf-8');
      expect(viewTsx).toContain("import { mountRaycastView } from '@asyar/raycast-compat/runner';");
      expect(viewTsx).toContain("'view-lorem': Cmd_0");

      const workerTs = fs.readFileSync(path.join(outDir, 'worker.ts'), 'utf-8');
      expect(workerTs).toContain(
        "import { startWorkerRunner } from '@asyar/raycast-compat/runner';",
      );
      expect(workerTs).toContain("'quick-copy': WorkerCmd_0");

      const viteConfig = fs.readFileSync(path.join(outDir, 'vite.config.ts'), 'utf-8');
      expect(viteConfig).toContain("'@raycast/api': '@asyar/raycast-compat'");
      expect(viteConfig).toContain("'@raycast/utils': '@asyar/raycast-compat/utils'");
    });

    it('generates only view entrypoints for view-only extension', () => {
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const pkg = {
        name: 'notes-viewer',
        title: 'Notes Viewer',
        commands: [
          {
            name: 'index',
            title: 'Browse Notes',
            mode: 'view',
          },
        ],
      };

      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));
      fs.writeFileSync(path.join(srcDir, 'index.tsx'), 'export default () => null;');

      const result = compileRaycastExtension({
        sourceDir: tmpDir,
      });

      expect(result.viewCommands).toEqual(['index']);
      expect(result.workerCommands).toHaveLength(0);
      expect(result.manifest.background).toBeUndefined();

      expect(fs.existsSync(path.join(tmpDir, 'view.html'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'view.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'worker.html'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'worker.ts'))).toBe(false);
    });

    it('copies assets directory and icon when copying to separate outDir', () => {
      const assetsDir = path.join(tmpDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(path.join(assetsDir, 'banner.png'), 'fake-image-bytes');
      fs.writeFileSync(path.join(tmpDir, 'icon.png'), 'fake-icon-bytes');

      const pkg = {
        name: 'asset-test',
        icon: 'icon.png',
        commands: [{ name: 'index', mode: 'view' }],
      };
      fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify(pkg, null, 2));

      const outDir = path.join(tmpDir, 'dist-ext');
      compileRaycastExtension({
        sourceDir: tmpDir,
        outDir,
      });

      expect(fs.existsSync(path.join(outDir, 'icon.png'))).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'assets', 'banner.png'))).toBe(true);
    });

    it('throws error when package.json is missing', () => {
      expect(() =>
        compileRaycastExtension({
          sourceDir: path.join(tmpDir, 'nonexistent'),
        }),
      ).toThrow(/package.json not found/);
    });
  });
});
