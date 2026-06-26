import { invokeSafe, invokeSafeVoid } from './invokeSafe';
import type { FrontmostApplication } from 'asyar-sdk/contracts';

export interface AppDataPath {
  path: string;
  sizeBytes: number;
  category: string;
}

export interface UninstallScanResult {
  appPath: string;
  appSizeBytes: number;
  dataPaths: AppDataPath[];
  totalBytes: number;
}

export async function getFrontmostApplication(): Promise<FrontmostApplication | null> {
  return invokeSafe<FrontmostApplication>('get_frontmost_application');
}

export async function appIsRunning(bundleId: string): Promise<boolean | null> {
  return invokeSafe<boolean>('app_is_running', { bundleId });
}

// `uninstall_application`/`set_application_scan_paths` are `Result<(), AppError>`
// on the Rust side — use invokeSafeVoid's boolean signal, not invokeSafe's null.

export async function uninstallApplication(
  path: string,
  dataPaths: string[] = [],
): Promise<boolean> {
  return invokeSafeVoid('uninstall_application', { path, dataPaths });
}

export async function scanUninstallTargets(path: string): Promise<UninstallScanResult | null> {
  return invokeSafe<UninstallScanResult>('scan_uninstall_targets', { path });
}

export async function applicationIndexSubscribe(
  extensionId: string | null,
  eventTypes: string[],
): Promise<string | null> {
  return invokeSafe<string>('application_index_subscribe', { extensionId, eventTypes });
}

export async function applicationIndexUnsubscribe(
  extensionId: string | null,
  subscriptionId: string,
): Promise<boolean> {
  return invokeSafeVoid('application_index_unsubscribe', { extensionId, subscriptionId });
}

export async function setApplicationScanPaths(paths: string[]): Promise<boolean> {
  return invokeSafeVoid('set_application_scan_paths', { paths });
}

export async function appUpdaterShouldShowWhatsNew(
  lastSeenVersion: string | undefined,
  currentVersion: string,
): Promise<boolean | null> {
  return invokeSafe<boolean>('app_updater_should_show_whats_new', {
    lastSeenVersion,
    currentVersion,
  });
}
