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
});
