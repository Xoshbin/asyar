import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { packageExtension } from '../lib/zip';
import { prepareExtensionForPackaging, readPackagedReadme } from '../lib/packaging';
import { isOwnGitRoot } from '../lib/extensionRepo';
import { readOriginRepo } from '../lib/publishGitGuard';
import { getDevExtensionsFile } from '../lib/platform';

export const PACKAGE_EXTENSION = '.asyar';

/**
 * Where `asyar pack` writes the package. No `--out`: the extension's own
 * folder. A directory (existing, or written with a trailing slash) gets the
 * default file name. Anything else is the file itself and must end in
 * `.asyar`, the only file "Install from file" accepts.
 */
export function resolvePackOutput(
  cwd: string,
  extensionId: string,
  version: string,
  out?: string,
): string {
  const fileName = `${extensionId}-${version}${PACKAGE_EXTENSION}`;
  if (!out) return path.join(cwd, fileName);

  const resolved = path.resolve(cwd, out);
  const isDirectory =
    /[\\/]$/.test(out) || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory());
  if (isDirectory) return path.join(resolved, fileName);
  if (path.extname(resolved) !== PACKAGE_EXTENSION) {
    throw new Error(`--out must be a folder or a file ending in ${PACKAGE_EXTENSION}`);
  }
  return resolved;
}

/** The flavors whose dev registry has this extension (`asyar link`/`attach`). */
function linkedFlavors(extensionId: string): string[] {
  return [false, true].flatMap((isDevFlavor) => {
    try {
      const registry = JSON.parse(fs.readFileSync(getDevExtensionsFile(isDevFlavor), 'utf-8'));
      return registry[extensionId] ? [isDevFlavor ? 'dev' : 'production'] : [];
    } catch {
      return [];
    }
  });
}

/** True when git would list `file` as a change of `repoRoot`'s repo. */
function isUnignoredInRepo(repoRoot: string, file: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '--quiet', file], { cwd: repoRoot, stdio: 'pipe' });
    return false;
  } catch (err: any) {
    // 1 means "not ignored"; anything else (no repo, git missing) is unknown.
    return err?.status === 1;
  }
}

export function registerPack(program: Command) {
  program
    .command('pack')
    .description('Build an installable .asyar package locally, without publishing')
    .option('--out <path>', 'Folder or .asyar file to write (default: the extension folder)')
    .addHelpText(
      'after',
      '\nInstall the package in Asyar via Settings → Extensions → Install from file.\n' +
        'Unlink the extension first (asyar unlink, or asyar unlink --dev): a linked\n' +
        'extension is loaded from your project folder instead of the installed package.',
    )
    .action(async (opts) => {
      const cwd = process.cwd();

      const manifest = await prepareExtensionForPackaging(cwd);

      let outPath: string;
      try {
        outPath = resolvePackOutput(cwd, manifest.id, manifest.version, opts.out);
      } catch (err: any) {
        console.error(chalk.red('✗ ' + err.message));
        process.exit(1);
      }

      // Same README as `asyar publish` would ship: links pinned to the
      // release tag of this extension's GitHub repo, read from git, not
      // the network. Without one, the links stay relative.
      const origin = isOwnGitRoot(cwd) ? readOriginRepo(cwd) : null;
      const readmeTarget = origin ? { ...origin, ref: `v${manifest.version}` } : null;
      const packagedReadme = readPackagedReadme(cwd, readmeTarget);

      const pkgSpinner = ora('Packaging extension...').start();
      const { zipPath, sizeBytes } = packageExtension(
        cwd,
        manifest.id,
        manifest.version,
        manifest.type === 'theme',
        packagedReadme,
      );
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        // Copy, not rename: the temp folder may be on another volume.
        fs.copyFileSync(zipPath, outPath);
      } finally {
        fs.rmSync(zipPath, { force: true });
      }
      pkgSpinner.succeed(`Extension packaged (${(sizeBytes / 1024).toFixed(1)} kB)`);

      console.log(chalk.green('\n✓ ') + outPath);
      console.log(chalk.gray('  Install it via Settings → Extensions → Install from file.'));

      const flavors = linkedFlavors(manifest.id);
      if (flavors.length > 0) {
        const commands = flavors.map((f) => (f === 'dev' ? 'asyar unlink --dev' : 'asyar unlink'));
        console.log(
          chalk.yellow('⚠') +
            ` ${manifest.id} is linked (${flavors.join(', ')}), so Asyar loads it from this folder,` +
            ' not from the installed package.',
        );
        console.log(chalk.gray(`  Run ${commands.join(' and ')} before installing.`));
      }

      if (
        outPath.startsWith(cwd + path.sep) &&
        isOwnGitRoot(cwd) &&
        isUnignoredInRepo(cwd, outPath)
      ) {
        console.log(
          chalk.yellow('⚠') +
            ` git sees ${path.relative(cwd, outPath)} as a new file, and "asyar publish" stops on uncommitted files.`,
        );
        console.log(chalk.gray(`  Add *${PACKAGE_EXTENSION} to .gitignore, or pack with --out.`));
      }
    });
}
