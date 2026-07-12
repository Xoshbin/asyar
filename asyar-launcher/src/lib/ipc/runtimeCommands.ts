import { invokeSafe, invokeSafeVoid } from './invokeSafe';

/** Mirrors Rust's `RuntimeDownloadProgress` (`runtimes/progress.rs`). */
export type RuntimeDownloadProgress =
  | { status: 'resolving' }
  | { status: 'downloading'; bytesDownloaded: number; totalBytes: number }
  | { status: 'verifying' }
  | { status: 'extracting' }
  | { status: 'signing' }
  | { status: 'ready' }
  | { status: 'failed'; error: string };

/** Mirrors Rust's `EnsureRuntimeResponse` (`commands/runtimes.rs`). */
export type EnsureRuntimeResult =
  { status: 'installed'; path: string } | { status: 'needsDownload'; sizeBytes: number };

export interface InstalledRuntimeInfo {
  name: string;
  version: string;
  path: string;
  sizeBytes: number;
}

export async function resolveRuntime(name: string): Promise<string | null> {
  return invokeSafe<string>('resolve_runtime', { name });
}

export async function ensureRuntime(name: string): Promise<EnsureRuntimeResult | null> {
  return invokeSafe<EnsureRuntimeResult>('ensure_runtime', { name });
}

export async function downloadRuntime(name: string): Promise<boolean> {
  return invokeSafeVoid('download_runtime', { name });
}

export async function listRuntimes(): Promise<InstalledRuntimeInfo[] | null> {
  return invokeSafe<InstalledRuntimeInfo[]>('list_runtimes');
}

export async function removeRuntime(name: string): Promise<boolean> {
  return invokeSafeVoid('remove_runtime', { name });
}
