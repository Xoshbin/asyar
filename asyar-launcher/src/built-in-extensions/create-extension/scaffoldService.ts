import { invoke } from '@tauri-apps/api/core';
import { Command } from '@tauri-apps/plugin-shell';

async function writeTextFile(path: string, content: string) {
  await invoke('write_text_file_absolute', { pathStr: path, content });
}

async function mkdir(path: string, options?: any) {
  await invoke('mkdir_absolute', { pathStr: path });
}

async function exists(path: string): Promise<boolean> {
  return await invoke('check_path_exists', { path });
}

// Import all templates as raw strings via Vite
import packageJsonTmpl from './template/package.json.tmpl?raw';
import viteConfigTmpl from './template/vite.config.ts.tmpl?raw';
import tsconfigTmpl from './template/tsconfig.json.tmpl?raw';
import indexTmpl from './template/src/index.ts.tmpl?raw';
import defaultViewTmpl from './template/src/DefaultView.svelte.tmpl?raw';
import manifestTmpl from './template/manifest.json.tmpl?raw';
import linkJsTmpl from './template/scripts/link.js.tmpl?raw';

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

  // Helper to replace placeholders
  const populate = (tmpl: string) => {
    return tmpl
      .replaceAll('{{EXTENSION_NAME}}', name)
      .replaceAll('{{EXTENSION_ID}}', id)
      .replaceAll('{{EXTENSION_DESC}}', description);
  };

  onProgress("Writing scaffold files...");

  // Write Root files
  await writeTextFile(`${location}/package.json`, populate(packageJsonTmpl));
  await writeTextFile(`${location}/vite.config.ts`, populate(viteConfigTmpl));
  await writeTextFile(`${location}/tsconfig.json`, populate(tsconfigTmpl));
  await writeTextFile(`${location}/manifest.json`, populate(manifestTmpl));
  await writeTextFile(`${location}/.gitignore`, "node_modules\ndist\n.env\n*.zip\n");

  // Create src and scripts folders
  if (!(await exists(`${location}/src`))) {
    await mkdir(`${location}/src`);
  }
  if (!(await exists(`${location}/scripts`))) {
    await mkdir(`${location}/scripts`);
  }

  // Write Source files
  await writeTextFile(`${location}/src/index.ts`, populate(indexTmpl));
  await writeTextFile(`${location}/src/DefaultView.svelte`, populate(defaultViewTmpl));
  await writeTextFile(`${location}/scripts/link.js`, populate(linkJsTmpl));

  // Run NPM Install
  onProgress("Running 'npm install'... (this may take a minute)");
  
  try {
    // Run npm install in the newly created directory
    // Note: this assumes npm is globally available on the developer's machine
    const installCmd = Command.create('npm', ['install'], { cwd: location });
    
    installCmd.on('error', error => console.error(`npm install error: "${error}"`));
    installCmd.stdout.on('data', line => console.log(`npm: "${line}"`));
    installCmd.stderr.on('data', line => console.error(`npm err: "${line}"`));
    
    const output = await installCmd.execute();
    
    if (output.code !== 0) {
      throw new Error(`npm install failed with code ${output.code}`);
    }
  } catch (error) {
    console.error("Failed to run npm install automatically:", error);
    onProgress("Files created. Note: Please run 'npm install' manually.");
    // We don't throw, we just warn them, so IDE can still open
  }

  onProgress("Opening IDE...");

  try {
    // Attempt to open VSCode
    const codeCmd = Command.create('code', ['.'], { cwd: location });
    await codeCmd.execute();
  } catch (e) {
    try {
      // Fallback: Just open the folder in native file explorer using plugin-shell's 'open'
      // Requires: import { open } from '@tauri-apps/plugin-shell';
      // but opening the directory with standard open command often works across OS
      const openCmd = Command.create('open', [location]);
      await openCmd.execute();
    } catch (fallbackError) {
      console.log("Could not open folder automatically", fallbackError);
    }
  }

  onProgress("Done!");
}
