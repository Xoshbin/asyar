import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(
  __dirname,
  '..',
  'src-tauri',
  'src',
  'runtimes',
  'catalog.fallback.json',
);

const REQUIRED_RUNTIMES = ['bun', 'uv', 'claude'];
const REQUIRED_PLATFORM_KEYS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
];

function loadCatalog() {
  return JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
}

// Guards the invariant that replaces build-time `externalBin` provisioning:
// every bundled runtime's baked-in fallback catalog entry must actually be
// downloadable on all 6 supported platforms, or `RuntimeManager` silently
// fails to resolve an artifact for whichever platform is missing.
describe('catalog.fallback.json coverage', () => {
  it('has an entry for every runtime bun/uv/claude ships as a bundled sidecar', () => {
    const catalog = loadCatalog();
    for (const name of REQUIRED_RUNTIMES) {
      expect(catalog.runtimes, `missing runtime entry: ${name}`).toHaveProperty(name);
    }
  });

  it('every runtime entry has at least one published version', () => {
    const catalog = loadCatalog();
    for (const name of REQUIRED_RUNTIMES) {
      const versions = Object.keys(catalog.runtimes[name].versions);
      expect(versions.length, `${name} has no published versions`).toBeGreaterThan(0);
    }
  });

  it('every published version covers all 6 platform keys', () => {
    const catalog = loadCatalog();
    for (const name of REQUIRED_RUNTIMES) {
      for (const [version, platforms] of Object.entries(catalog.runtimes[name].versions)) {
        for (const platformKey of REQUIRED_PLATFORM_KEYS) {
          expect(
            platforms,
            `${name}@${version} is missing platform '${platformKey}'`,
          ).toHaveProperty(platformKey);
        }
      }
    }
  });

  it('every platform artifact has url/sha256/archiveFormat, and binaryPathInArchive iff not raw', () => {
    const catalog = loadCatalog();
    for (const name of REQUIRED_RUNTIMES) {
      for (const [version, platforms] of Object.entries(catalog.runtimes[name].versions)) {
        for (const [platformKey, artifact] of Object.entries(platforms)) {
          const label = `${name}@${version} (${platformKey})`;
          expect(artifact.url, `${label} missing url`).toBeTruthy();
          expect(artifact.sha256, `${label} missing sha256`).toBeTruthy();
          expect(artifact.archiveFormat, `${label} missing archiveFormat`).toBeTruthy();

          if (artifact.archiveFormat === 'raw') {
            expect(
              artifact.binaryPathInArchive == null,
              `${label} is raw but declares a binaryPathInArchive`,
            ).toBe(true);
          } else {
            expect(
              artifact.binaryPathInArchive,
              `${label} is archived (${artifact.archiveFormat}) but has no binaryPathInArchive`,
            ).toBeTruthy();
          }
        }
      }
    }
  });
});
