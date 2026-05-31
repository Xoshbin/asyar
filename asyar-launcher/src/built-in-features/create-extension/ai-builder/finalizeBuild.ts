import { invoke } from '@tauri-apps/api/core';
import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { scanForSecret, type ScannedFile, type SecretScanResult } from './secretGuard';
import { buildJobStore } from './buildJobStore.svelte';

const TEXT_EXT = ['.ts', '.js', '.svelte', '.json', '.html', '.css', '.md'];

async function collectSourceFiles(dir: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  async function walk(path: string) {
    const entries = await readDir(path);
    for (const e of entries) {
      const full = `${path}/${e.name}`;
      if (e.isDirectory) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        await walk(full);
      } else if (TEXT_EXT.some((x) => e.name.endsWith(x))) {
        out.push({ path: full, content: await readTextFile(full) });
      }
    }
  }
  await walk(dir);
  return out;
}

export async function finalizeBuild(path: string, extensionId: string): Promise<SecretScanResult> {
  const secret = buildJobStore.buildSecret;
  if (secret && secret.trim().length > 0) {
    const files = await collectSourceFiles(path);
    const result = scanForSecret(files, secret);
    if (result.leaked) return result;
  }
  await invoke('register_dev_extension', { extensionId, path });
  const { ExtensionManagerProxy } = await import('asyar-sdk/contracts');
  await new ExtensionManagerProxy().reloadExtensions();
  return { leaked: false };
}
