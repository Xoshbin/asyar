const DEBOUNCE_MS = 200;

class ExtensionPendingState {
  private _pending = $state<Set<string>>(new Set());
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  isPending(extensionId: string): boolean {
    return this._pending.has(extensionId);
  }

  markPending(extensionId: string): void {
    if (this.timers.has(extensionId) || this._pending.has(extensionId)) return;
    const t = setTimeout(() => {
      const s = new Set(this._pending);
      s.add(extensionId);
      this._pending = s;
      this.timers.delete(extensionId);
    }, DEBOUNCE_MS);
    this.timers.set(extensionId, t);
  }

  markReady(extensionId: string): void {
    const t = this.timers.get(extensionId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(extensionId);
    }
    if (this._pending.has(extensionId)) {
      const s = new Set(this._pending);
      s.delete(extensionId);
      this._pending = s;
    }
  }

  reset(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this._pending = new Set();
  }
}

export const extensionPendingState = new ExtensionPendingState();
