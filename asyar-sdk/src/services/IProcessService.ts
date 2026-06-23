export type ProcessSortBy = 'cpu' | 'memory' | 'name';

export interface ProcessInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  path: string;
  owner: string;
  protected: boolean;
}

export interface AppGroup {
  appName: string;
  icon?: string | null;
  owner: string;
  totalCpu: number;
  totalMemoryBytes: number;
  processCount: number;
  protected: boolean;
  children: ProcessInfo[];
}

export interface KillFailure {
  pid: number;
  error: string;
}

export interface KillResult {
  killed: number[];
  failed: KillFailure[];
}

export interface ListProcessesOptions {
  query?: string;
  sortBy: ProcessSortBy;
}

export interface KillProcessesOptions {
  /** App-group kill = all child pids. */
  pids: number[];
  /** true → SIGKILL; false → graceful (SIGTERM / TerminateProcess). */
  force: boolean;
  /** Must be true to kill a process the host flagged `protected`. */
  confirmedProtected?: boolean;
}

/**
 * Lists and kills OS processes. Requires `process:read` (list) and
 * `process:kill` (kill) manifest permissions. The host re-derives the
 * protected flag from a live snapshot and refuses protected kills unless
 * `confirmedProtected` is true.
 */
export interface IProcessService {
  list(options: ListProcessesOptions): Promise<AppGroup[]>;
  kill(options: KillProcessesOptions): Promise<KillResult>;
}
