import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TAURI_CONF = resolve(__dirname, '..', 'src-tauri', 'tauri.conf.json');

// Sidecars (bun/uv/claude) are no longer build-time-bundled via Tauri
// `externalBin` — they're downloaded on demand at first use by
// `RuntimeManager`. This guards against that regressing: a binary declared
// in `externalBin` without being provisioned fails every platform's build at
// bundle time with "resource path 'binaries/<name>-<triple>' doesn't exist".
describe('externalBin', () => {
  it('declares no runtime binaries', () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, 'utf8'));
    const externalBin = conf.bundle?.externalBin ?? [];
    expect(externalBin).toEqual([]);
  });
});
