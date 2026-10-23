import type { HostPlatform } from '../../lib/keyboard/hostPlatform';

const STORE_APP_PREFIX = 'shell:AppsFolder\\';

/**
 * Microsoft Store apps are indexed as `shell:AppsFolder\<AUMID>`: launchable,
 * but with no file or folder behind them, so file-based actions don't apply.
 */
export function isStoreAppPath(path: string): boolean {
  return path.startsWith(STORE_APP_PREFIX);
}

/** Reveal / Copy Path apply to any indexed app that has a real path. */
export function hasAppFilePath(path: string | null | undefined): path is string {
  return !!path && !isStoreAppPath(path);
}

/**
 * Run as administrator is a Windows UAC feature. Rust only elevates an
 * existing `.lnk` or `.exe`, so the action is hidden for everything else.
 */
export function canRunAsAdmin(path: string | null | undefined, platform: HostPlatform): boolean {
  return platform === 'windows' && hasAppFilePath(path) && /\.(lnk|exe)$/i.test(path);
}
