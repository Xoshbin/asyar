import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface ZipResult {
  zipPath: string;
  checksum: string;
  sizeBytes: number;
}

export function packageExtension(
  cwd: string,
  extensionId: string,
  version: string,
  isTheme = false,
): ZipResult {
  const zip = new AdmZip();

  if (isTheme) {
    // Theme packages: manifest.json + theme.json + optional fonts/
    zip.addLocalFile(path.join(cwd, 'manifest.json'));
    zip.addLocalFile(path.join(cwd, 'theme.json'));

    const fontsDir = path.join(cwd, 'fonts');
    if (fs.existsSync(fontsDir)) {
      addDirectoryToZip(zip, fontsDir, 'fonts');
    }
  } else {
    const distDir = path.join(cwd, 'dist');
    if (!fs.existsSync(distDir)) {
      throw new Error('dist/ not found. Run "asyar build" first.');
    }
    // dist/ is flattened into the archive root, so path declarations that
    // point into dist/ must describe that packaged layout too.
    const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'manifest.json'), 'utf8'));
    if (manifest.background?.main) {
      manifest.background.main = toPackagedPath(manifest.background.main);
    }
    zip.addFile('manifest.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    // dist/ contents flattened into zip root
    addDirectoryToZip(zip, distDir, '');
  }

  const zipFileName = `${extensionId}-${version}.zip`;
  const zipPath = path.join(os.tmpdir(), zipFileName);
  const fileBuffer = zip.toBuffer();
  fs.writeFileSync(zipPath, fileBuffer);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  return {
    zipPath,
    checksum: `sha256:${hash}`,
    sizeBytes: fileBuffer.length,
  };
}

export function toPackagedPath(entry: string): string {
  return entry.startsWith('dist/') ? entry.slice('dist/'.length) : entry;
}

export function computeChecksum(buffer: Buffer): string {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  return `sha256:${hash}`;
}

function addDirectoryToZip(zip: AdmZip, dirPath: string, zipPrefix: string) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const newPrefix = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
      addDirectoryToZip(zip, fullPath, newPrefix);
    } else {
      zip.addLocalFile(fullPath, zipPrefix);
    }
  }
}
