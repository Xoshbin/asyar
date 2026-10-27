import * as fs from 'fs';
import * as path from 'path';

/**
 * The Store takes the extension icon out of the published package, the
 * way the VS Code Marketplace takes it out of a .vsix. These checks run
 * at publish so a broken icon fails here, not on the Store page.
 */

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|svg)$/i;

/** Package-relative path of a file icon, or null for emoji, `icon:` names and other forms. */
export function iconFilePath(icon: unknown): string | null {
  if (typeof icon !== 'string' || icon.startsWith('icon:') || !IMAGE_FILE.test(icon)) {
    return null;
  }
  let packagePath = icon;
  while (packagePath.startsWith('./')) packagePath = packagePath.slice(2);
  return packagePath;
}

export function checkStoreIcon(
  icon: unknown,
  packageRoot: string,
): { errors: string[]; warnings: string[] } {
  const packagePath = iconFilePath(icon);
  if (!packagePath) return { errors: [], warnings: [] };

  if (!fs.existsSync(path.join(packageRoot, packagePath))) {
    return {
      errors: [`The icon file "${packagePath}" is not in the package.`],
      warnings: [],
    };
  }

  // Like VS Code, the Store never serves SVG (it can carry scripts). It
  // stays fine for the launcher, so this warns instead of failing.
  if (/\.svg$/i.test(packagePath)) {
    return {
      errors: [],
      warnings: [
        `The Store can't show SVG icons, so it will show your initials instead. Use a PNG icon to show it in the Store.`,
      ],
    };
  }

  return { errors: [], warnings: [] };
}
