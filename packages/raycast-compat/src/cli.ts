#!/usr/bin/env node
import * as path from 'path';
import { compileRaycastExtension } from './compiler/index.js';

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: asyar-raycast-compile <sourceDir> [outDir] [options]

Compiles / scaffolds an unpacked Raycast extension into an Asyar-compatible extension directory.

Arguments:
  sourceDir         Path to unpacked Raycast extension (containing package.json)
  outDir            Target output directory (defaults to sourceDir if omitted)

Options:
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

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--id-prefix' && i + 1 < args.length) {
      idPrefix = args[++i];
    } else if (arg === '--sdk-version' && i + 1 < args.length) {
      sdkVersion = args[++i];
    } else if (!arg.startsWith('-') && !outDir) {
      outDir = arg;
    }
  }

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
    console.log('\nReady to test with: asyar link');
  } catch (err: any) {
    console.error(`✗ Compilation failed: ${err.message}`);
    process.exit(1);
  }
}

main();
