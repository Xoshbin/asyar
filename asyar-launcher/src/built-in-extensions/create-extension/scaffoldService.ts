import { invoke } from '@tauri-apps/api/core';
import { Command } from '@tauri-apps/plugin-shell';
import { openPath } from '@tauri-apps/plugin-opener';

async function writeTextFile(path: string, content: string) {
  await invoke('write_text_file_absolute', { pathStr: path, content });
}

async function mkdir(path: string, options?: any) {
  await invoke('mkdir_absolute', { pathStr: path });
}

async function exists(path: string): Promise<boolean> {
  return await invoke('check_path_exists', { path });
}

/**
 * Resolve the SDK version to use in scaffolded extensions.
 * Tries npm registry first (always gets the latest published version),
 * falls back to a safe default if offline.
 */
async function getLatestSdkVersion(): Promise<string> {
  try {
    const cmd = Command.create('npm', ['view', 'asyar-sdk', 'version']);
    const output = await cmd.execute();
    if (output.code === 0 && output.stdout.trim()) {
      return `^${output.stdout.trim()}`;
    }
  } catch {}
  // Offline fallback
  return '^1.1.0';
}

// Import all templates as raw strings via Vite
import packageJsonTmpl from './template/package.json.tmpl?raw';
import viteConfigTmpl from './template/vite.config.ts.tmpl?raw';
import tsconfigTmpl from './template/tsconfig.json.tmpl?raw';
import indexTmpl from './template/src/index.ts.tmpl?raw';
import mainTmpl from './template/src/main.ts.tmpl?raw';
import defaultViewTmpl from './template/src/DefaultView.svelte.tmpl?raw';
import manifestTmpl from './template/manifest.json.tmpl?raw';
import indexHtmlTmpl from './template/index.html.tmpl?raw';

export interface ScaffoldOptions {
  name: string;
  id: string;
  description: string;
  location: string;
  onProgress: (status: string) => void;
}

export async function generateExtension(options: ScaffoldOptions): Promise<void> {
  const { name, id, description, location, onProgress } = options;

  onProgress("Preparing file system...");

  // Ensure the target directory exists
  if (!(await exists(location))) {
    await mkdir(location, { recursive: true });
  }

  // Resolve the latest SDK version for the template
  onProgress("Resolving latest SDK version...");
  const sdkVersion = await getLatestSdkVersion();

  // Helper to replace placeholders
  const populate = (tmpl: string) => {
    return tmpl
      .replaceAll('{{EXTENSION_NAME}}', name)
      .replaceAll('{{EXTENSION_ID}}', id)
      .replaceAll('{{EXTENSION_DESC}}', description)
      .replaceAll('{{SDK_VERSION}}', sdkVersion);
  };

  onProgress("Writing scaffold files...");

  // Write Root files
  await writeTextFile(`${location}/package.json`, populate(packageJsonTmpl));
  await writeTextFile(`${location}/vite.config.ts`, populate(viteConfigTmpl));
  await writeTextFile(`${location}/tsconfig.json`, populate(tsconfigTmpl));
  await writeTextFile(`${location}/manifest.json`, populate(manifestTmpl));
  await writeTextFile(`${location}/index.html`, populate(indexHtmlTmpl));
  await writeTextFile(`${location}/.gitignore`, "node_modules\ndist\n.env\n*.zip\n");

  // Create src folder
  if (!(await exists(`${location}/src`))) {
    await mkdir(`${location}/src`);
  }

  // Write Source files
  await writeTextFile(`${location}/src/index.ts`, populate(indexTmpl));
  await writeTextFile(`${location}/src/main.ts`, populate(mainTmpl));
  await writeTextFile(`${location}/src/DefaultView.svelte`, populate(defaultViewTmpl));

  // Run NPM Install
  onProgress("Running 'pnpm install'... (this may take a minute)");
  
  try {
    // Run npm install in the newly created directory
    // Note: this assumes npm is globally available on the developer's machine
    const installCmd = Command.create('pnpm', ['install'], { cwd: location });
    
    installCmd.on('error', error => console.error(`pnpm install error: "${error}"`));
    installCmd.stdout.on('data', line => console.log(`pnpm: "${line}"`));
    installCmd.stderr.on('data', line => console.error(`pnpm err: "${line}"`));
    
    const output = await installCmd.execute();
    
    if (output.code !== 0) {
      throw new Error(`pnpm install failed with code ${output.code}`);
    }
  } catch (error) {
    console.error("Failed to run pnpm install automatically:", error);
    onProgress("Files created. Note: Please run 'pnpm install' manually.");
    // We don't throw, we just warn them, so IDE can still open
  }

  onProgress("Registering development extension...");
  try {
    await invoke('register_dev_extension', { extensionId: id, path: location });
  } catch (error) {
    console.error("Failed to register dev extension automatically:", error);
    onProgress("Note: Failed to register for auto-loading. You may need to run 'asyar link'.");
  }

  onProgress("Opening IDE...");

  try {
    // Attempt to open VSCode
    const codeCmd = Command.create('code', ['.'], { cwd: location });
    await codeCmd.execute();
  } catch (e) {
    try {
      // Fallback: open the folder in the native file explorer (cross-platform)
      await openPath(location);
    } catch (fallbackError) {
      console.log("Could not open folder automatically", fallbackError);
    }
  }

  onProgress("Done!");
}
