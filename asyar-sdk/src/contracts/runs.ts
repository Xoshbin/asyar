export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RunKind = 'ai-chat' | 'shell-script' | 'agent' | 'custom';

export interface Run {
  id: string;
  kind: RunKind;
  label: string;
  status: RunStatus;
  extensionId?: string;
  startedAt: number;
  endedAt?: number;
  cancellable: boolean;
  errorMessage?: string;
}

export interface RunHandle {
  readonly id: string;
  write(line: string): Promise<void>;
  done(): Promise<void>;
  fail(error: string): Promise<void>;
  cancel(): Promise<void>;
  onCancel(cb: () => void): () => void;
  /**
   * True after the launcher confirms cancellation via the cancel event.
   * Note: not synchronously true after `cancel()` resolves — the event arrives on a round-trip.
   */
  readonly cancelled: boolean;
}

export interface RunStartInput {
  label: string;
  kind: RunKind;
  cancellable?: boolean;
}

export interface IRunService {
  /**
   * Start a new run. The returned handle holds a cancel-event subscription;
   * always call `done()`, `fail()`, or `cancel()` to release it.
   */
  start(input: RunStartInput): Promise<RunHandle>;
}
