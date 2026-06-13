import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeSafe } from '../../lib/ipc/invokeSafe';
import type { Run, RunKind } from 'asyar-sdk/contracts';

import { diagnosticsService } from '../diagnostics/diagnosticsService.svelte';
import { pickExtensionIframe } from '../extension/extensionIframeSelector';
import { shiftIndex } from '../../lib/listSelection.svelte';

export interface LocalRunHandle {
  readonly id: string;
  write(line: string): Promise<void>;
  done(): Promise<void>;
  fail(error: string): Promise<void>;
  cancel(): Promise<void>;
  onCancel(cb: () => void): () => void;
}

const UNACK_FAILED_CAP = 5;

export class RunService {
  active = $state<Run[]>([]);
  recent = $state<Run[]>([]);
  /**
   * Failed runs from the current session that the user hasn't yet dismissed.
   * Surfaced inline in the launcher list alongside active runs (per issue #314)
   * so failures stay visible for inspection. Capped at UNACK_FAILED_CAP; reset
   * on launcher restart (the persistent record lives in `recent` / SQLite).
   */
  unacknowledgedFailures = $state<Run[]>([]);
  /**
   * Succeeded agent runs that the user hasn't dismissed yet — kept in the
   * launcher's main list as `run-done` rows (a green-dot persistent entry)
   * until the user explicitly dismisses via Cmd+K → Dismiss Thread.
   *
   * Deduped by `subjectId` (the per-agent dynamic-command id set by
   * `agentLoop.ts`) — one entry per agent. A newer successful run of the
   * same agent replaces the older kept entry. Capped at UNACK_FAILED_CAP to
   * match the failure slice's safety bound. Reset on launcher restart;
   * persistent history still lives in `recent` / SQLite.
   */
  keptAgents = $state<Run[]>([]);
  /**
   * Succeeded shell-script runs that the user hasn't dismissed yet — surfaced
   * as `run-done` rows so script output stays inspectable after the run ends.
   * Deduped by `subjectId` when present (so re-running the same script row
   * collapses into one entry); anonymous runs are deduped by id. Capped at
   * UNACK_FAILED_CAP.
   */
  unacknowledgedScriptResults = $state<Run[]>([]);
  selectedRunId = $state<string | null>(null);
  activeCount = $derived(this.active.length);
  /**
   * Merged list of active runs followed by recent runs, deduped by id
   * (active wins). This is the canonical ordering rendered by RunView's
   * sidebar and the basis for keyboard navigation.
   */
  combined = $derived.by(() => {
    const activeIds = new Set(this.active.map((r) => r.id));
    return [...this.active, ...this.recent.filter((r) => !activeIds.has(r.id))];
  });

  private stateChangedUnlisten: UnlistenFn | null = null;
  private outputUnlisten: UnlistenFn | null = null;
  private localCancelCallbacks: Map<string, Set<() => void>> = new Map();

  constructor() {
    this.subscribe();
  }

  private async subscribe(): Promise<void> {
    if (this.stateChangedUnlisten) {
      this.stateChangedUnlisten();
      this.stateChangedUnlisten = null;
    }
    if (this.outputUnlisten) {
      this.outputUnlisten();
      this.outputUnlisten = null;
    }

    this.stateChangedUnlisten = await listen<Run>('runs:state-changed', (ev) => {
      this.onStateChanged(ev.payload);
    });

    this.outputUnlisten = await listen<{ id: string; line: string }>('runs:output', (ev) => {
      this.onOutputLine(ev.payload);
    });
  }

  async start(
    extensionId: string | null,
    id: string,
    kind: RunKind,
    label: string,
    cancellable: boolean,
    subjectId: string | null = null,
  ): Promise<Run> {
    const run = await invokeSafe<Run>('runs_start', { id, kind, label, extensionId, cancellable, subjectId });
    if (!run) {
      throw new Error('runs_start failed');
    }
    return run;
  }

  async write(extensionId: string | null, id: string, line: string): Promise<void> {
    await invokeSafe('runs_write', { id, line });
  }

  async done(extensionId: string | null, id: string): Promise<void> {
    await invokeSafe('runs_done', { id });
  }

  async fail(extensionId: string | null, id: string, error: string): Promise<void> {
    await invokeSafe('runs_fail', { id, error });
  }

  async cancel(extensionId: string | null, id: string): Promise<void> {
    await invokeSafe('runs_cancel', { id });
  }

  async loadHistory(): Promise<void> {
    const history = await invokeSafe<Run[]>('runs_history_list', { limit: 50 });
    if (history) {
      this.recent = history;
    }
  }

  async clearHistory(): Promise<void> {
    await invokeSafe('runs_history_clear');
    this.recent = [];
  }

  async cancelById(id: string): Promise<void> {
    await invokeSafe('runs_cancel', { id });
  }

  /**
   * Move the highlighted run one slot up or down in the `combined` list,
   * wrapping at the ends. No-op when the list is empty. With nothing
   * selected, picks the first item on a 'down' move and the last on 'up'.
   */
  moveSelection(direction: 'up' | 'down'): void {
    const items = this.combined;
    if (items.length === 0) return;
    const currentIndex = this.selectedRunId
      ? items.findIndex((r) => r.id === this.selectedRunId)
      : -1;
    if (currentIndex < 0) {
      this.selectedRunId = items[0].id;
      return;
    }
    const next = shiftIndex(currentIndex, items.length, direction);
    this.selectedRunId = items[next].id;
  }

  private onStateChanged(run: Run): void {
    const existingIdx = this.active.findIndex((r) => r.id === run.id);
    const isTerminal =
      run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';

    if (isTerminal) {
      if (existingIdx >= 0) {
        this.active = [
          ...this.active.slice(0, existingIdx),
          ...this.active.slice(existingIdx + 1),
        ];
      }
      this.recent = [run, ...this.recent].slice(0, 50);

      if (run.status === 'failed') {
        diagnosticsService.report({
          kind: 'run_failed',
          severity: 'warning',
          retryable: true,
          source: 'frontend',
          context: { runId: run.id },
        });

        // Keep the failure surfaced in the launcher's main list for inspection.
        // De-dupe by id in case state-changed fires twice for the same run.
        this.unacknowledgedFailures = [
          run,
          ...this.unacknowledgedFailures.filter((r) => r.id !== run.id),
        ].slice(0, UNACK_FAILED_CAP);
      }

      if (run.status === 'succeeded' && run.kind === 'agent' && run.subjectId) {
        // Threads persist after success — replace any older kept entry for
        // the same agent so each agent shows at most one "Done" row.
        this.keptAgents = [
          run,
          ...this.keptAgents.filter((r) => r.subjectId !== run.subjectId),
        ].slice(0, UNACK_FAILED_CAP);
      }

      if (run.status === 'succeeded' && run.kind === 'shell-script') {
        // Scripts persist after success so the user can read the output.
        // Dedupe by subjectId when present so re-running the same script row
        // collapses into one entry; anonymous (no subjectId) runs dedupe by id.
        const filtered = run.subjectId
          ? this.unacknowledgedScriptResults.filter((r) => r.subjectId !== run.subjectId)
          : this.unacknowledgedScriptResults.filter((r) => r.id !== run.id);
        this.unacknowledgedScriptResults = [run, ...filtered].slice(0, UNACK_FAILED_CAP);
      }

      if (run.status === 'cancelled' && run.extensionId) {
        const iframe = pickExtensionIframe(run.extensionId, 'worker');
        iframe?.contentWindow?.postMessage(
          { type: 'asyar:event:runs:cancel', payload: { id: run.id } },
          '*',
        );
      }

      if (run.status === 'cancelled') {
        const localCallbacks = this.localCancelCallbacks.get(run.id);
        if (localCallbacks) {
          for (const cb of [...localCallbacks]) cb();
        }
      }

      // Free the callback set on any terminal status, regardless of whether it was cancelled.
      this.localCancelCallbacks.delete(run.id);
    } else {
      if (existingIdx >= 0) {
        this.active = [
          ...this.active.slice(0, existingIdx),
          run,
          ...this.active.slice(existingIdx + 1),
        ];
      } else {
        this.active = [...this.active, run];
      }
    }
  }

  private onOutputLine(_payload: { id: string; line: string }): void {
    // No state change; output is consumed by RunView via runs_get_output Tauri command.
  }

  /**
   * User-initiated dismissal of a failed run from the inline launcher list.
   * Does NOT delete the persistent history record in `recent` / SQLite — the
   * full record is still inspectable from RunView's Recent section.
   */
  dismissFailure(id: string): void {
    this.unacknowledgedFailures = this.unacknowledgedFailures.filter((r) => r.id !== id);
  }

  /**
   * User-initiated dismissal of a kept (succeeded agent) run from the inline
   * launcher list. Same semantics as `dismissFailure`: removes the row from
   * the launcher but keeps the persistent SQLite record intact.
   */
  dismissKeptAgent(id: string): void {
    this.keptAgents = this.keptAgents.filter((r) => r.id !== id);
  }

  /**
   * User-initiated dismissal of a succeeded shell-script result row. Drops
   * the row from the launcher list AND frees the in-memory output buffer
   * via `runs_dismiss`. The persistent SQLite history record (including the
   * captured `tailOutput`) is unaffected.
   */
  dismissScriptResult(id: string): void {
    this.unacknowledgedScriptResults = this.unacknowledgedScriptResults.filter((r) => r.id !== id);
    void invokeSafe('runs_dismiss', { id });
  }

  async startLocal(input: {
    label: string;
    kind: RunKind;
    cancellable?: boolean;
    extensionId?: string | null;
    /**
     * Run-to-item join key — `cmd_scripts_dyn_<id>` for a script dispatch,
     * `cmd_agents_dyn_<id>` for an agent loop. Set so the launcher list
     * can light up the originating row with a status dot.
     */
    subjectId?: string | null;
  }): Promise<LocalRunHandle> {
    const id = crypto.randomUUID();
    await this.start(
      input.extensionId ?? null,
      id,
      input.kind,
      input.label,
      input.cancellable ?? false,
      input.subjectId ?? null,
    );
    return this.buildLocalHandle(id);
  }

  private buildLocalHandle(id: string): LocalRunHandle {
    return {
      get id() { return id; },
      write: (line: string) => this.write(null, id, line),
      done: () => this.done(null, id),
      fail: (error: string) => this.fail(null, id, error),
      cancel: () => this.cancel(null, id),
      onCancel: (cb: () => void) => {
        let set = this.localCancelCallbacks.get(id);
        if (!set) {
          set = new Set();
          this.localCancelCallbacks.set(id, set);
        }
        set.add(cb);
        return () => {
          const current = this.localCancelCallbacks.get(id);
          if (!current) return;
          current.delete(cb);
          if (current.size === 0) this.localCancelCallbacks.delete(id);
        };
      },
    };
  }

  reset(): void {
    if (this.stateChangedUnlisten) {
      this.stateChangedUnlisten();
      this.stateChangedUnlisten = null;
    }
    if (this.outputUnlisten) {
      this.outputUnlisten();
      this.outputUnlisten = null;
    }
    this.active = [];
    this.recent = [];
    this.unacknowledgedFailures = [];
    this.keptAgents = [];
    this.unacknowledgedScriptResults = [];
    this.selectedRunId = null;
    this.subscribe();
  }
}

export const runService = new RunService();
