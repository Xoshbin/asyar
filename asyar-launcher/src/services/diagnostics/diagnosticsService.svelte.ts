import type { Diagnostic, IDiagnosticsService, Severity } from 'asyar-sdk/contracts';

const TTL_MS: Record<Severity, number | null> = {
  info: 3000,
  success: 3000,
  warning: 8000,
  error: null,    // sticky
  fatal: null,    // sticky + modal
};

export class DiagnosticsService implements IDiagnosticsService {
  current = $state<Diagnostic | null>(null);
  private clearTimer: ReturnType<typeof setTimeout> | null = null;
  private retryRegistry = new Map<string, () => Promise<void>>();
  private retryCounter = 0;
  private lastKindAt = new Map<string, number>();
  private readonly COALESCE_WINDOW_MS = 1000;

  /**
   * Service signature accepts the full `Diagnostic`. The SDK proxy
   * (`IDiagnosticsService.report` from contracts) uses `Omit<Diagnostic,
   * 'source' | 'extensionId'>`; the IPC router injects those fields
   * before invoking the host service.
   */
  async report(d: Diagnostic): Promise<void> {
    const now = Date.now();
    const previousAt = this.lastKindAt.get(d.kind) ?? 0;
    const coalesces =
      (d.severity === 'info' || d.severity === 'success') &&
      now - previousAt < this.COALESCE_WINDOW_MS &&
      this.current?.kind === d.kind;
    this.lastKindAt.set(d.kind, now);
    if (coalesces) return;

    this.clearAutoClearTimer();
    this.current = d;
    const ttl = TTL_MS[d.severity];
    if (ttl !== null) {
      this.clearTimer = setTimeout(() => {
        if (this.current === d) this.current = null;
        this.clearTimer = null;
      }, ttl);
    }
  }

  dismiss(): void {
    this.clearAutoClearTimer();
    this.current = null;
  }

  registerRetry(fn: () => Promise<void>): string {
    const id = `retry-${++this.retryCounter}`;
    this.retryRegistry.set(id, fn);
    return id;
  }

  async triggerRetry(id: string): Promise<void> {
    const fn = this.retryRegistry.get(id);
    if (!fn) return;
    this.retryRegistry.delete(id);
    await fn();
  }

  reset(): void {
    this.clearAutoClearTimer();
    this.current = null;
    this.retryRegistry.clear();
    this.retryCounter = 0;
    this.lastKindAt.clear();
  }

  private clearAutoClearTimer(): void {
    if (this.clearTimer !== null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }
}

export const diagnosticsService = new DiagnosticsService();
