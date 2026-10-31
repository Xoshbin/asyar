// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { packageExtension } from './zip';

describe('packageExtension', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('makes every declared worker path resolve inside the flattened archive', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-package-test-'));
    tempDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, 'dist'));
    fs.writeFileSync(path.join(cwd, 'dist', 'worker.js'), 'export {};');
    fs.writeFileSync(
      path.join(cwd, 'manifest.json'),
      JSON.stringify({
        id: 'org.asyar.fixture',
        version: '1.0.0',
        background: { main: 'dist/worker.js' },
      }),
    );

    const extensionId = `org.asyar.fixture.${path.basename(cwd)}`;
    const result = packageExtension(cwd, extensionId, '1.0.0');
    const zip = new AdmZip(result.zipPath);
    const manifestEntry = zip.getEntry('manifest.json');
    expect(manifestEntry).not.toBeNull();
    const manifestBytes = zip.readFile(manifestEntry!);
    expect(manifestBytes).not.toBeNull();
    expect(manifestBytes!.byteLength).toBeGreaterThan(0);
    const packagedManifest = JSON.parse(new TextDecoder().decode(manifestBytes!));

    expect(packagedManifest.background.main).toBe('worker.js');
    expect(zip.getEntry(packagedManifest.background.main)).not.toBeNull();
  });

  function makeExtension(): string {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-package-test-'));
    tempDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, 'dist'));
    fs.writeFileSync(path.join(cwd, 'dist', 'index.js'), 'export {};');
    fs.writeFileSync(
      path.join(cwd, 'manifest.json'),
      JSON.stringify({ id: 'org.asyar.fixture', version: '1.0.0' }),
    );
    return cwd;
  }

  function readEntry(zipPath: string, name: string): string | null {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries().filter((e) => e.entryName === name);
    expect(entries.length).toBeLessThanOrEqual(1);
    return entries[0] ? zip.readAsText(entries[0]) : null;
  }

  it('ships the given README at the archive root', () => {
    const cwd = makeExtension();
    const result = packageExtension(cwd, 'org.asyar.fixture', '1.0.0', false, '# Timer\n');
    expect(readEntry(result.zipPath, 'README.md')).toBe('# Timer\n');
  });

  it('ships the given README in theme packages too', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-package-test-'));
    tempDirs.push(cwd);
    fs.writeFileSync(path.join(cwd, 'manifest.json'), '{"id":"org.asyar.theme"}');
    fs.writeFileSync(path.join(cwd, 'theme.json'), '{}');
    const result = packageExtension(cwd, 'org.asyar.theme', '1.0.0', true, '# Theme\n');
    expect(readEntry(result.zipPath, 'README.md')).toBe('# Theme\n');
  });

  it('ships the icon file in theme packages, so the Store can show it', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'asyar-package-test-'));
    tempDirs.push(cwd);
    fs.mkdirSync(path.join(cwd, 'assets'));
    fs.writeFileSync(path.join(cwd, 'assets', 'icon.png'), 'png-bytes');
    fs.writeFileSync(
      path.join(cwd, 'manifest.json'),
      JSON.stringify({ id: 'org.asyar.theme', icon: 'assets/icon.png' }),
    );
    fs.writeFileSync(path.join(cwd, 'theme.json'), '{}');
    const result = packageExtension(cwd, 'org.asyar.theme', '1.0.0', true);
    expect(readEntry(result.zipPath, 'assets/icon.png')).toBe('png-bytes');
  });

  it('replaces a README.md that the build copied into dist/', () => {
    const cwd = makeExtension();
    fs.writeFileSync(path.join(cwd, 'dist', 'README.md'), 'stale copy');
    const result = packageExtension(cwd, 'org.asyar.fixture', '1.0.0', false, '# Rewritten\n');
    expect(readEntry(result.zipPath, 'README.md')).toBe('# Rewritten\n');
  });

  it('adds no README when none is given', () => {
    const cwd = makeExtension();
    const result = packageExtension(cwd, 'org.asyar.fixture', '1.0.0');
    expect(readEntry(result.zipPath, 'README.md')).toBeNull();
  });
});
