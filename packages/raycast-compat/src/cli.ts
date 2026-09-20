#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import {
  compileRaycastExtension,
  searchRaycastStore,
  downloadRaycastExtension,
} from './compiler/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAppDataDir(isDev = false): string {
  const bundleId = isDev ? 'org.asyar.dev' : 'org.asyar.app';
  switch (process.platform) {
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', bundleId);
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        bundleId,
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'),
        bundleId,
      );
  }
}

function resolveViteBin(): string {
  const binName = process.platform === 'win32' ? 'vite.cmd' : 'vite';
  for (const startDir of [__dirname, process.cwd()]) {
    let cur = startDir;
    while (cur !== path.dirname(cur)) {
      const candidate = path.join(cur, 'node_modules', '.bin', binName);
      if (fs.existsSync(candidate)) {
        return `"${candidate}"`;
      }
      cur = path.dirname(cur);
    }
  }
  return 'npx vite';
}

function linkExtension(extensionId: string, extensionDir: string, isDev = false): void {
  const appData = getAppDataDir(isDev);
  const extensionsDir = path.join(appData, 'extensions');
  const targetSymlink = path.join(extensionsDir, extensionId);

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  const isSamePath = (p1: string, p2: string) => {
    try {
      return path.resolve(p1) === path.resolve(p2);
    } catch {
      return false;
    }
  };

  // Remove existing symlink or directory
  try {
    const stat = fs.lstatSync(targetSymlink);
    if (stat) {
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(targetSymlink);
      } else if (stat.isDirectory()) {
        if (!isSamePath(targetSymlink, extensionDir)) {
          fs.rmSync(targetSymlink, { recursive: true, force: true });
        }
      } else {
        fs.unlinkSync(targetSymlink);
      }
    }
  } catch {
    // doesn't exist yet
  }

  if (!isSamePath(targetSymlink, extensionDir)) {
    try {
      fs.symlinkSync(extensionDir, targetSymlink, 'junction');
      console.log(`✓ Linked symlink to: ${targetSymlink}`);
    } catch (err: any) {
      console.warn(`⚠️  Could not create symlink: ${err.message}`);
    }
  } else {
    console.log(`✓ Extension already installed at: ${targetSymlink}`);
  }

  // Register in dev_extensions.json
  const devFile = path.join(appData, 'dev_extensions.json');
  let devRegistry: Record<string, string> = {};
  if (fs.existsSync(devFile)) {
    try {
      devRegistry = JSON.parse(fs.readFileSync(devFile, 'utf-8'));
    } catch {
      devRegistry = {};
    }
  }

  devRegistry[extensionId] = extensionDir;
  const tmpFile = `${devFile}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpFile, JSON.stringify(devRegistry, null, 2), 'utf-8');
  fs.renameSync(tmpFile, devFile);
  console.log(`✓ Registered ${extensionId} in: ${devFile}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: asyar-raycast-compile <sourceDir> [outDir] [options]
       asyar-raycast-compile --install <extension-name|url> [options]
       asyar-raycast-compile --search <query>

Compiles, builds, and links Raycast extensions into Asyar.

Commands:
  --search <query>    Search official Raycast Store for extensions
  --install <name>    Download, compile, build, and link an extension directly

Arguments:
  sourceDir           Path to unpacked Raycast extension (containing package.json)
  outDir              Target output directory (defaults to sourceDir if omitted)

Options:
  --build             Automatically run vite build after compilation
  --link              Link extension into Asyar's extensions folder and dev registry
  --dev               Target development flavor (org.asyar.dev) when linking (default: true for --install)
  --id-prefix         Custom ID prefix (default: org.asyar.raycast)
  --sdk-version       Target Asyar SDK version (default: ^4.11.0)
  --help, -h          Show this help message
`);
    process.exit(0);
  }

  // Handle --search
  if (args[0] === '--search') {
    const query = args[1];
    if (!query) {
      console.error(
        'Error: Please provide a search query (e.g. asyar-raycast-compile --search git)',
      );
      process.exit(1);
    }
    console.log(`🔍 Searching Raycast Store for "${query}"...`);
    try {
      const results = await searchRaycastStore(query);
      if (results.length === 0) {
        console.log('No extensions found.');
      } else {
        console.log(`\nFound ${results.length} extensions:\n`);
        for (const item of results.slice(0, 15)) {
          console.log(
            `• \x1b[1m${item.title}\x1b[0m (\x1b[36m${item.name}\x1b[0m) by ${item.author?.name || item.author?.handle}`,
          );
          console.log(`  ${item.description || 'No description'}`);
          console.log(
            `  ⬇️  ${item.download_count?.toLocaleString() ?? 0} downloads | Commands: ${(item.commands || []).map((c) => c.title).join(', ')}\n`,
          );
        }
        console.log(`To install any extension, run:`);
        console.log(`  asyar-raycast-compile --install <name>\n`);
      }
    } catch (err: any) {
      console.error(`✗ Search failed: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // Handle --install
  let sourceDir = args[0];
  let isRemoteInstall = false;
  let outDir: string | undefined = undefined;
  let idPrefix: string | undefined = undefined;
  let sdkVersion: string | undefined = undefined;
  let shouldBuild = false;
  let shouldLink = false;
  let isDev = true;

  if (args[0] === '--install') {
    isRemoteInstall = true;
    const identifier = args[1];
    if (!identifier) {
      console.error(
        'Error: Please provide an extension name or URL (e.g. asyar-raycast-compile --install clean-keyboard)',
      );
      process.exit(1);
    }

    shouldBuild = true;
    shouldLink = true;

    let downloadUrlArg: string | undefined = undefined;
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--out-dir' && i + 1 < args.length) {
        outDir = args[++i];
      } else if (arg === '--download-url' && i + 1 < args.length) {
        downloadUrlArg = args[++i];
      } else if (arg === '--prod') {
        isDev = false;
      }
    }

    try {
      const { extensionDir } = await downloadRaycastExtension(identifier, outDir, downloadUrlArg);
      sourceDir = extensionDir;
      outDir = extensionDir;
    } catch (err: any) {
      console.error(`✗ Download failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--id-prefix' && i + 1 < args.length) {
        idPrefix = args[++i];
      } else if (arg === '--sdk-version' && i + 1 < args.length) {
        sdkVersion = args[++i];
      } else if (arg === '--build') {
        shouldBuild = true;
      } else if (arg === '--link') {
        shouldLink = true;
      } else if (arg === '--dev') {
        isDev = true;
      } else if (!arg.startsWith('-') && !outDir) {
        outDir = arg;
      }
    }
  }

  const finalTargetDir = path.resolve(outDir || sourceDir);

  try {
    console.log(`\nAdapting Raycast extension from: ${path.resolve(sourceDir)}`);
    const result = compileRaycastExtension({
      sourceDir,
      outDir,
      idPrefix,
      sdkVersion,
    });

    console.log(`✓ Extension ID: ${result.manifest.id}`);
    console.log(`✓ Name: ${result.manifest.name} (v${result.manifest.version})`);
    console.log(`✓ View Commands: ${result.viewCommands.join(', ') || 'none'}`);
    console.log(`✓ Worker Commands: ${result.workerCommands.join(', ') || 'none'}`);
    console.log(`✓ Created ${result.filesCreated.length} files in target directory.`);

    if (shouldBuild) {
      console.log(`\nBuilding bundle in ${finalTargetDir}...`);
      const viteBin = resolveViteBin();
      execSync(`${viteBin} build`, { cwd: finalTargetDir, stdio: 'inherit' });
      console.log('✓ Build complete.');
    }

    if (shouldLink) {
      console.log(`\nLinking extension ${result.manifest.id}...`);
      linkExtension(result.manifest.id, finalTargetDir, isDev);
      console.log('✓ Extension linked and ready in Asyar!');
    } else if (!shouldBuild) {
      console.log('\nReady to build and link with:');
      console.log(`  cd ${finalTargetDir} && npx vite build`);
      console.log(`  asyar-raycast-compile ${sourceDir} --build --link --dev`);
    }
  } catch (err: any) {
    console.error(`✗ Compilation failed: ${err.message}`);
    process.exit(1);
  }
}

void main();
