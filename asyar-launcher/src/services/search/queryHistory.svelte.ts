import {
  queryHistoryCommands,
  type QueryHistoryCommands,
} from '../../lib/ipc/queryHistoryCommands';

export type QueryHistoryBackend = Partial<QueryHistoryCommands>;

/** A launcher-owned recall presenter. Persistence, retention, and cursor navigation belong to Rust. */
export class QueryHistory {
  current = $state<string | null>(null);
  private entries: string[] | null = null;
  private index = -1;
  private generation = 0;
  private sessionId = 'session-0';
  private pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: QueryHistoryBackend = queryHistoryCommands) {}

  reset() {
    this.generation++;
    this.sessionId = `session-${this.generation}`;
    this.current = null;
    this.entries = null;
    this.index = -1;
    void this.storage.reset?.();
  }

  record(query: string) {
    this.reset();
    this.pending = this.pending.then(() => this.storage.record?.(query));
    return this.pending;
  }

  navigate(
    direction: -1 | 1,
    query: string,
    selectedIndex: number,
    apply: (query: string) => void,
  ): boolean {
    if (this.current === null && (direction !== -1 || query !== '' || selectedIndex > 0)) {
      return false;
    }
    void this.move(direction, query, apply);
    return true;
  }

  async move(
    direction: -1 | 1,
    query: string,
    apply: (query: string) => void = () => {},
  ): Promise<string | null> {
    if (this.current !== null && query !== this.current) this.reset();
    if (this.current === null && (query !== '' || direction === 1)) return null;
    const generation = this.generation;
    const sessionId = this.sessionId;

    let recalled: string | null = null;
    if (this.storage.navigate) {
      const nav = this.storage.navigate;
      const res = await this.pending.then(() => nav(sessionId, direction));
      if (generation !== this.generation || res === null) return null;
      recalled = res;
      this.current = recalled === '' ? null : recalled;
    } else if (this.storage.list) {
      if (this.entries === null) {
        const load = this.storage.list;
        const entries = await this.pending.then(() => load());
        if (generation !== this.generation || entries === null) return null;
        this.entries = entries;
      }
      if (this.entries.length === 0) return null;
      this.index = Math.max(-1, Math.min(this.entries.length - 1, this.index - direction));
      this.current = this.index < 0 ? null : this.entries[this.index];
      recalled = this.current ?? '';
    }

    if (generation !== this.generation || recalled === null) return null;
    apply(recalled);
    return recalled;
  }

  async deleteCurrent(): Promise<boolean> {
    const query = this.current;
    if (query === null) return false;
    const deleted = Boolean(await this.storage.delete?.(query));
    if (deleted && this.current === query) this.reset();
    return deleted;
  }
}
