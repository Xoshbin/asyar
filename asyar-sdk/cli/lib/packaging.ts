import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { readManifest, lintManifest, AsyarManifest } from './manifest';
import { runViteBuild, verifyBuildOutput } from '../commands/build';
import { checkStoreIcon } from './storeIcon';
import { rewriteReadmeLinks, findMissingFiles, ReadmeLinkTarget } from './readme';

/**
 * The steps that decide what goes into a package, shared by `asyar publish`
 * and `asyar pack` so the two can never package differently. Neither step
 * needs the network; on failure they print why and exit, as the commands do.
 */

/**
 * Get the newest file modification time in a directory (recursive).
 */
function getNewestMtime(dir: string): number {
  let newest = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      newest = Math.max(newest, getNewestMtime(fullPath));
    } else {
      newest = Math.max(newest, fs.statSync(fullPath).mtimeMs);
    }
  }
  return newest;
}

/** Validate, build and check the output, then return the manifest. */
export async function prepareExtensionForPackaging(cwd: string): Promise<AsyarManifest> {
  // 1. Validate & Lint
  const manifest = readManifest(cwd);
  const { errors, warnings } = lintManifest(manifest, cwd);
  if (warnings.length > 0) {
    warnings.forEach((w) => console.log(chalk.yellow('  ⚠️ ') + `${w.field}: ${w.message}`));
  }
  if (errors.length > 0) {
    console.log(chalk.red('✗ Validation failed:'));
    errors.forEach((e) => console.log(chalk.red(`  ✗ ${e.field}: ${e.message}`)));
    process.exit(1);
  }
  console.log(chalk.green('✓ Validation passed'));

  // 2. Build (skip for theme extensions — no JS to compile)
  if (manifest.type !== 'theme') {
    try {
      await runViteBuild(cwd);
      verifyBuildOutput(cwd, manifest);
    } catch {
      process.exit(1);
    }

    // 2b. Guard: verify build output is fresh
    const srcMtime = getNewestMtime(path.join(cwd, 'src'));
    const manifestMtime = fs.statSync(path.join(cwd, 'manifest.json')).mtimeMs;
    const distMtime = getNewestMtime(path.join(cwd, 'dist'));
    if (distMtime > 0 && Math.max(srcMtime, manifestMtime) > distMtime) {
      console.error(chalk.red('\n✗ Source files are newer than the build output.'));
      console.error(chalk.gray('  The build may have failed or produced stale output.'));
      console.error(chalk.gray('  Run "asyar build" and check for errors before packaging.'));
      process.exit(1);
    }
  } else {
    console.log(chalk.green('✓ Theme extension — skipping build step'));
  }

  // 2c. The Store takes the icon out of the package, so it must be in it.
  const iconCheck = checkStoreIcon(
    (manifest as unknown as Record<string, unknown>).icon,
    manifest.type === 'theme' ? cwd : path.join(cwd, 'dist'),
  );
  iconCheck.warnings.forEach((w) => console.log(chalk.yellow('  ⚠️ ') + `icon: ${w}`));
  if (iconCheck.errors.length > 0) {
    iconCheck.errors.forEach((e) => console.error(chalk.red(`✗ icon: ${e}`)));
    process.exit(1);
  }

  return manifest;
}

/**
 * The README that ships inside the package, or undefined when there is none.
 * With a `target`, relative links are pinned to that repo and tag so they work
 * on asyar.org and in the launcher. Without one they stay as written. Either
 * way, every image the README shows must exist.
 */
export function readPackagedReadme(
  cwd: string,
  target: ReadmeLinkTarget | null,
): string | undefined {
  const readmePath = path.join(cwd, 'README.md');
  if (!fs.existsSync(readmePath)) return undefined;

  const original = fs.readFileSync(readmePath, 'utf8');
  // The rewrite also finds the relative images; without a target the
  // rewritten text is discarded, so the placeholder never ships.
  const { markdown, relativeImages } = rewriteReadmeLinks(
    original,
    target ?? { owner: '_', repo: '_', ref: '_' },
  );
  const missing = findMissingFiles(cwd, relativeImages);
  if (missing.length > 0) {
    console.error(chalk.red('\n✗ README.md shows images that do not exist:'));
    missing.forEach((file) => console.error(chalk.red(`    ${file}`)));
    console.error(chalk.gray('  Fix the paths or add the files, then try again.'));
    process.exit(1);
  }
  return target ? markdown : original;
}
