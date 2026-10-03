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

/** Mirrors Rust's `RuntimeDownloadWire` (`commands/runtimes.rs`). */
export interface RuntimeDownload {
  name: string;
  sizeBytes: number;
}

export async function resolveRuntime(name: string): Promise<string | null> {
  return invokeSafe<string | null>('resolve_runtime', { name });
}

export async function ensureRuntime(name: string): Promise<EnsureRuntimeResult> {
  return invokeSafe<EnsureRuntimeResult>('ensure_runtime', { name });
}

/**
 * `consumer`, when passed (e.g. `ext:<extensionId>`), registers this
 * runtime as needed by that consumer once the download succeeds.
 */
export async function downloadRuntime(name: string, consumer?: string): Promise<boolean> {
  return invokeSafeVoid('download_runtime', { name, consumer: consumer ?? null });
}

export async function listRuntimes(): Promise<InstalledRuntimeInfo[]> {
  return invokeSafe<InstalledRuntimeInfo[]>('list_runtimes');
}

export async function removeRuntime(name: string): Promise<boolean> {
  return invokeSafeVoid('remove_runtime', { name });
}

/** Sizes for the subset of `names` not yet installed. */
export async function getRuntimeDownloadSizes(names: string[]): Promise<RuntimeDownload[]> {
  return invokeSafe<RuntimeDownload[]>('get_runtime_download_sizes', { names });
}

/** Consumer ids (e.g. `ext:<id>`, `mcp:<id>`, `builtin:ext-builder`) currently requiring `name`. */
export async function getRuntimeConsumers(name: string): Promise<string[]> {
  return invokeSafe<string[]>('get_runtime_consumers', { name });
}
