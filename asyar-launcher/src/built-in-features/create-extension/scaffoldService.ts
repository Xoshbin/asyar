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
  } catch { }
  return '^2.2.0';
}

// ── Shared templates (all non-theme types) ──────────────────────────────────
import packageJsonTmpl from './template/package.json.tmpl?raw';
import viteConfigTmpl from './template/vite.config.ts.tmpl?raw';
import tsconfigTmpl from './template/tsconfig.json.tmpl?raw';
import readmeTmpl from './template/README.md.tmpl?raw';
import viewHtmlTmpl from './template/view.html.tmpl?raw';
import workerHtmlTmpl from './template/worker.html.tmpl?raw';

// ── View type (mode=view only) ──────────────────────────────────────────────
import manifestViewTmpl from './template/manifest.json.tmpl?raw';
import viewTsTmpl from './template/src/view.ts.tmpl?raw';
import defaultViewTmpl from './template/src/DefaultView.svelte.tmpl?raw';

// ── Result type (searchable + view for detail) ──────────────────────────────
import manifestResultTmpl from './template/manifest.json.result.tmpl?raw';
import viewTsResultTmpl from './template/src/view.ts.result.tmpl?raw';
import workerTsResultTmpl from './template/src/worker.ts.result.tmpl?raw';
import detailViewTmpl from './template/src/DetailView.svelte.result.tmpl?raw';

// ── Logic type (mode=background only) ───────────────────────────────────────
import manifestLogicTmpl from './template/manifest.json.logic.tmpl?raw';
import workerTsLogicTmpl from './template/src/worker.ts.logic.tmpl?raw';

// ── Theme type ──────────────────────────────────────────────────────────────
import manifestThemeTmpl from './template/manifest.json.theme.tmpl?raw';
import themeJsonTmpl from './template/theme.json.tmpl?raw';
import readmeThemeTmpl from './template/README.md.theme.tmpl?raw';

export type ExtensionType = 'view' | 'result' | 'logic' | 'theme';

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

  // ── Theme path: no JS, no build, no SDK dependency ────────────────────────
  if (extensionType === 'theme') {
    onProgress("Writing theme files...");
    const populateBasic = (tmpl: string) =>
      tmpl
        .replaceAll('{{EXTENSION_NAME}}', name)
        .replaceAll('{{EXTENSION_ID}}', id)
        .replaceAll('{{EXTENSION_DESC}}', description);

    await writeTextFile(`${location}/manifest.json`, populateBasic(manifestThemeTmpl));
    await writeTextFile(`${location}/theme.json`, themeJsonTmpl);
    await writeTextFile(`${location}/.gitignore`, "*.zip\n");
    await writeTextFile(`${location}/README.md`, populateBasic(readmeThemeTmpl));

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
    return;
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

  // ── Shared root files (all non-theme types) ───────────────────────────────
  await writeTextFile(`${location}/package.json`, populate(packageJsonTmpl));
  await writeTextFile(`${location}/vite.config.ts`, populate(viteConfigTmpl));
  await writeTextFile(`${location}/tsconfig.json`, populate(tsconfigTmpl));
  await writeTextFile(`${location}/.gitignore`, "node_modules\ndist\n.env\n*.zip\n");
  await writeTextFile(`${location}/README.md`, populate(readmeTmpl));

  // ── src/ directory ────────────────────────────────────────────────────────
  if (!(await exists(`${location}/src`))) {
    await mkdir(`${location}/src`);
  }

  // ── Type-specific files ───────────────────────────────────────────────────
  if (extensionType === 'view') {
    // view-only: view.html + src/view.ts + DefaultView.svelte
    await writeTextFile(`${location}/manifest.json`, populate(manifestViewTmpl));
    await writeTextFile(`${location}/view.html`, populate(viewHtmlTmpl));
    await writeTextFile(`${location}/src/view.ts`, populate(viewTsTmpl));
    await writeTextFile(`${location}/src/DefaultView.svelte`, populate(defaultViewTmpl));
  } else if (extensionType === 'result') {
    // result: dual-entry — worker owns search(), view mounts DetailView
    await writeTextFile(`${location}/manifest.json`, populate(manifestResultTmpl));
    await writeTextFile(`${location}/view.html`, populate(viewHtmlTmpl));
    await writeTextFile(`${location}/worker.html`, populate(workerHtmlTmpl));
    await writeTextFile(`${location}/src/view.ts`, populate(viewTsResultTmpl));
    await writeTextFile(`${location}/src/worker.ts`, populate(workerTsResultTmpl));
    await writeTextFile(`${location}/src/DetailView.svelte`, populate(detailViewTmpl));
  } else if (extensionType === 'logic') {
    // logic: worker-only (no view). Background command + optional search().
    await writeTextFile(`${location}/manifest.json`, populate(manifestLogicTmpl));
    await writeTextFile(`${location}/worker.html`, populate(workerHtmlTmpl));
    await writeTextFile(`${location}/src/worker.ts`, populate(workerTsLogicTmpl));
  }

  // ── Install & build ───────────────────────────────────────────────────────
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

  // ── Register dev extension ────────────────────────────────────────────────
  onProgress("Registering development extension...");
  try {
    await invoke('register_dev_extension', { extensionId: id, path: location });
  } catch (error) {
    logService.error(`Failed to register dev extension automatically: ${error}`);
    onProgress("Note: Failed to register for auto-loading. You may need to run 'asyar link'.");
  }

  // ── Open IDE ──────────────────────────────────────────────────────────────
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
