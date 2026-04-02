import { invoke } from '@tauri-apps/api/core';
import { Command } from '@tauri-apps/plugin-shell';
import { openPath } from '@tauri-apps/plugin-opener';
import { logService } from '../../services/log/logService';

async function writeTextFile(path: string, content: string) {
  await invoke('write_text_file_absolute', { pathStr: path, content });
}

async function mkdir(path: string) {
  await invoke('mkdir_absolute', { pathStr: path });
}

async function exists(path: string): Promise<boolean> {
  return await invoke('check_path_exists', { path });
}

const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win');
const npmCommand = isWindows ? 'npm-cmd' : 'npm';
const pnpmCommand = isWindows ? 'pnpm-cmd' : 'pnpm';
const codeCommand = isWindows ? 'code-cmd' : 'code';

/**
 * Resolve the SDK version to use in scaffolded extensions.
 * Tries npm registry first (always gets the latest published version),
 * falls back to a safe default if offline.
 */
async function getLatestSdkVersion(): Promise<string> {
  try {
    const cmd = Command.create(npmCommand, ['view', 'asyar-sdk', 'version']);
    const output = await cmd.execute();
    if (output.code === 0 && output.stdout.trim()) {
      return `^${output.stdout.trim()}`;
    }
  } catch {}
  return '^1.6.0'; // Offline fallback
}

// ── Shared templates ────────────────────────────────────────────────────────
import packageJsonTmpl from './template/package.json.tmpl?raw';
import viteConfigTmpl from './template/vite.config.ts.tmpl?raw';
import tsconfigTmpl from './template/tsconfig.json.tmpl?raw';
import indexHtmlTmpl from './template/index.html.tmpl?raw';
import readmeTmpl from './template/README.md.tmpl?raw';

// ── View type templates ──────────────────────────────────────────────────────
import manifestViewTmpl from './template/manifest.json.tmpl?raw';
import indexViewTmpl from './template/src/index.ts.tmpl?raw';
import mainViewTmpl from './template/src/main.ts.tmpl?raw';
import defaultViewTmpl from './template/src/DefaultView.svelte.tmpl?raw';

// ── Result type templates ────────────────────────────────────────────────────
import manifestResultTmpl from './template/manifest.json.result.tmpl?raw';
import indexResultTmpl from './template/src/index.ts.result.tmpl?raw';
import mainResultTmpl from './template/src/main.ts.result.tmpl?raw';
import detailViewTmpl from './template/src/DetailView.svelte.result.tmpl?raw';

// ── Logic type templates ─────────────────────────────────────────────────────
import manifestLogicTmpl from './template/manifest.json.logic.tmpl?raw';
import indexLogicTmpl from './template/src/index.ts.logic.tmpl?raw';
import mainLogicTmpl from './template/src/main.ts.logic.tmpl?raw';

export type ExtensionType = 'view' | 'result' | 'logic';

export interface ScaffoldOptions {
  name: string;
  id: string;
  description: string;
  location: string;
  extensionType: ExtensionType;
  onProgress: (status: string) => void;
}

export async function generateExtension(options: ScaffoldOptions): Promise<void> {
  const { name, id, description, location, extensionType, onProgress } = options;

  onProgress("Preparing file system...");

  if (!(await exists(location))) {
    await mkdir(location);
  }

  onProgress("Resolving latest SDK version...");
  const sdkVersion = await getLatestSdkVersion();

  const populate = (tmpl: string) =>
    tmpl
      .replaceAll('{{EXTENSION_NAME}}', name)
      .replaceAll('{{EXTENSION_ID}}', id)
      .replaceAll('{{EXTENSION_DESC}}', description)
      .replaceAll('{{SDK_VERSION}}', sdkVersion);

  onProgress("Writing scaffold files...");

  // ── Shared root files ──────────────────────────────────────────────────────
  await writeTextFile(`${location}/package.json`, populate(packageJsonTmpl));
  await writeTextFile(`${location}/vite.config.ts`, populate(viteConfigTmpl));
  await writeTextFile(`${location}/tsconfig.json`, populate(tsconfigTmpl));
  await writeTextFile(`${location}/index.html`, populate(indexHtmlTmpl));
  await writeTextFile(`${location}/.gitignore`, "node_modules\ndist\n.env\n*.zip\n");
  await writeTextFile(`${location}/README.md`, populate(readmeTmpl));

  // ── Type-specific manifest ─────────────────────────────────────────────────
  const manifestTmpl =
    extensionType === 'result' ? manifestResultTmpl :
    extensionType === 'logic'  ? manifestLogicTmpl  :
    manifestViewTmpl;

  await writeTextFile(`${location}/manifest.json`, populate(manifestTmpl));

  // ── src/ directory ─────────────────────────────────────────────────────────
  if (!(await exists(`${location}/src`))) {
    await mkdir(`${location}/src`);
  }

  // index.ts — the extension class
  const indexTmpl =
    extensionType === 'result' ? indexResultTmpl :
    extensionType === 'logic'  ? indexLogicTmpl  :
    indexViewTmpl;

  await writeTextFile(`${location}/src/index.ts`, populate(indexTmpl));

  // main.ts — the iframe bootstrap
  const mainTmpl =
    extensionType === 'logic'  ? mainLogicTmpl  :
    extensionType === 'result' ? mainResultTmpl :
    mainViewTmpl;

  await writeTextFile(`${location}/src/main.ts`, populate(mainTmpl));

  // Svelte view component(s)
  if (extensionType === 'view') {
    await writeTextFile(`${location}/src/DefaultView.svelte`, populate(defaultViewTmpl));
  } else if (extensionType === 'result') {
    await writeTextFile(`${location}/src/DetailView.svelte`, populate(detailViewTmpl));
  }
  // logic type: no Svelte view

  // ── Install & build ────────────────────────────────────────────────────────
  onProgress("Running 'pnpm install'... (this may take a minute)");

  try {
    let installOutput: { code: number | null };
    let buildOutput: { code: number | null };

    if (isWindows) {
      const installCmd = Command.create('cmd-exe', ['/c', 'pnpm install'], { cwd: location });
      installCmd.on('error', error => logService.error(`pnpm install error: "${error}"`));
      installCmd.stdout.on('data', line => logService.debug(`pnpm: "${line}"`));
      installCmd.stderr.on('data', line => logService.error(`pnpm err: "${line}"`));
      installOutput = await installCmd.execute();
    } else {
      const installCmd = Command.create('sh', ['-l', '-c', 'pnpm install'], { cwd: location });
      installCmd.on('error', error => logService.error(`pnpm install error: "${error}"`));
      installCmd.stdout.on('data', line => logService.debug(`pnpm: "${line}"`));
      installCmd.stderr.on('data', line => logService.error(`pnpm err: "${line}"`));
      installOutput = await installCmd.execute();
    }

    if (installOutput.code !== 0) {
      throw new Error(`pnpm install failed with code ${installOutput.code}`);
    }

    onProgress("Building extension...");

    if (isWindows) {
      const buildCmd = Command.create('cmd-exe', ['/c', 'pnpm run build'], { cwd: location });
      buildCmd.on('error', error => logService.error(`pnpm build error: "${error}"`));
      buildCmd.stdout.on('data', line => logService.debug(`pnpm build: "${line}"`));
      buildCmd.stderr.on('data', line => logService.error(`pnpm build err: "${line}"`));
      buildOutput = await buildCmd.execute();
    } else {
      const buildCmd = Command.create('sh', ['-l', '-c', 'pnpm run build'], { cwd: location });
      buildCmd.on('error', error => logService.error(`pnpm build error: "${error}"`));
      buildCmd.stdout.on('data', line => logService.debug(`pnpm build: "${line}"`));
      buildCmd.stderr.on('data', line => logService.error(`pnpm build err: "${line}"`));
      buildOutput = await buildCmd.execute();
    }

    if (buildOutput.code !== 0) {
      throw new Error(`pnpm run build failed with code ${buildOutput.code}`);
    }
  } catch (error) {
    logService.error(`Failed to run commands automatically: ${error}`);
    onProgress("Note: Could not build automatically. Please run 'pnpm install && pnpm run build' in the extension directory.");
  }

  // ── Register dev extension ─────────────────────────────────────────────────
  onProgress("Registering development extension...");
  try {
    await invoke('register_dev_extension', { extensionId: id, path: location });
  } catch (error) {
    logService.error(`Failed to register dev extension automatically: ${error}`);
    onProgress("Note: Failed to register for auto-loading. You may need to run 'asyar link'.");
  }

  // ── Open IDE ───────────────────────────────────────────────────────────────
  onProgress("Opening IDE...");
  try {
    const codeCmd = Command.create(codeCommand, ['.'], { cwd: location });
    await codeCmd.execute();
  } catch {
    try {
      await openPath(location);
    } catch (fallbackError) {
      logService.debug(`Could not open folder automatically: ${fallbackError}`);
    }
  }

  onProgress("Done!");
}
