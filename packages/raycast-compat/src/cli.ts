#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { compileRaycastExtension } from './compiler/index.js';

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

function linkExtension(extensionId: string, extensionDir: string, isDev = false): void {
  const appData = getAppDataDir(isDev);
  const extensionsDir = path.join(appData, 'extensions');
  const targetSymlink = path.join(extensionsDir, extensionId);

  if (!fs.existsSync(extensionsDir)) {
    fs.mkdirSync(extensionsDir, { recursive: true });
  }

  // Remove existing symlink or directory
  try {
    const stat = fs.lstatSync(targetSymlink);
    if (stat) {
      fs.unlinkSync(targetSymlink);
    }
  } catch {
    // doesn't exist yet
  }

  try {
    fs.symlinkSync(extensionDir, targetSymlink, 'junction');
    console.log(`✓ Linked symlink to: ${targetSymlink}`);
  } catch (err: any) {
    console.warn(`⚠️  Could not create symlink: ${err.message}`);
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

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: asyar-raycast-compile <sourceDir> [outDir] [options]

Compiles, builds, and links an unpacked Raycast extension into Asyar.

Arguments:
  sourceDir         Path to unpacked Raycast extension (containing package.json)
  outDir            Target output directory (defaults to sourceDir if omitted)

Options:
  --build           Automatically run vite build after compilation
  --link            Link extension into Asyar's extensions folder and dev registry
  --dev             Target development flavor (org.asyar.dev) when linking
  --id-prefix       Custom ID prefix (default: org.asyar.raycast)
  --sdk-version     Target Asyar SDK version (default: ^4.11.0)
  --help, -h        Show this help message
`);
    process.exit(0);
  }

  const sourceDir = args[0];
  let outDir: string | undefined = undefined;
  let idPrefix: string | undefined = undefined;
  let sdkVersion: string | undefined = undefined;
  let shouldBuild = false;
  let shouldLink = false;
  let isDev = false;

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

  const finalTargetDir = path.resolve(outDir || sourceDir);

  try {
    console.log(`Adapting Raycast extension from: ${path.resolve(sourceDir)}`);
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
      execSync('npx vite build', { cwd: finalTargetDir, stdio: 'inherit' });
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

main();
