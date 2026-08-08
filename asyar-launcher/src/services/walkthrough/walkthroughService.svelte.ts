import type { ExtensionManifest } from 'asyar-sdk/contracts';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  WALKTHROUGH_CHANGED_EVENT,
  completeAllWalkthroughTasks,
  completeWalkthroughTask,
  getWalkthrough,
  resetWalkthrough,
  setWalkthroughDismissed,
  syncWalkthroughTasks,
  uncompleteWalkthroughTask,
  type WalkthroughContribution,
  type WalkthroughSnapshot,
  type WalkthroughTaskView,
} from '../../lib/ipc/walkthroughCommands';
import { logService } from '../log/logService';

const EMPTY: WalkthroughSnapshot = {
  tasks: [],
  progress: { total: 0, completed: 0, percent: 0, nextTaskId: null },
  dismissed: false,
};

/**
 * Collect every manifest-declared walkthrough task. Pure so the collection
 * rule stays testable without a loaded extension host.
 */
export function collectContributions(manifests: ExtensionManifest[]): WalkthroughContribution[] {
  return manifests
    .filter((m) => m?.id && Array.isArray(m.walkthrough) && m.walkthrough.length > 0)
    .map((m) => ({ extensionId: m.id, tasks: m.walkthrough! }));
}

/**
 * Counters that launch history cannot express, for `state` completion rules.
 * Every value is a count; Rust compares it against the rule's `atLeast`.
 */
export interface ProbeSources {
  snippetCount: () => number;
  aliasCount: () => number;
  shortcutCount: () => number;
  portalCount: () => number;
  noteCount: () => number;
  installedExtensionCount: () => number;
}

export function collectProbes(sources: ProbeSources): Record<string, number> {
  const safe = (read: () => number) => {
    try {
      return read() || 0;
    } catch {
      return 0;
    }
  };
  return {
    'snippets.count': safe(sources.snippetCount),
    'aliases.count': safe(sources.aliasCount),
    'shortcuts.count': safe(sources.shortcutCount),
    'portals.count': safe(sources.portalCount),
    'notes.count': safe(sources.noteCount),
    'extensions.installedCount': safe(sources.installedExtensionCount),
  };
}

class WalkthroughService {
  private snapshot = $state<WalkthroughSnapshot>(EMPTY);
  private unlisten: UnlistenFn | null = null;

  get tasks(): WalkthroughTaskView[] {
    return this.snapshot.tasks;
  }

  get progress() {
    return this.snapshot.progress;
  }

  get dismissed(): boolean {
    return this.snapshot.dismissed;
  }

  /** Show the root-search row only while there is something left to learn. */
  get shouldShowInRoot(): boolean {
    const { total, completed } = this.snapshot.progress;
    return !this.snapshot.dismissed && total > 0 && completed < total;
  }

  getTask(taskId: string): WalkthroughTaskView | undefined {
    return this.snapshot.tasks.find((t) => t.id === taskId);
  }

  /**
   * Push the declared tasks to Rust and adopt the evaluated result. Called
   * once after extensions load; re-running it is safe and cheap.
   */
  async sync(manifests: ExtensionManifest[], probes: Record<string, number>): Promise<void> {
    const contributions = collectContributions(manifests);
    const result = await syncWalkthroughTasks(contributions, probes);
    if (result) this.snapshot = result;
  }

  /** Live updates when a launch completes a task while the app is running. */
  async subscribe(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<WalkthroughSnapshot>(WALKTHROUGH_CHANGED_EVENT, (event) => {
      if (event.payload) this.snapshot = event.payload;
    });
  }

  async unsubscribe(): Promise<void> {
    this.unlisten?.();
    this.unlisten = null;
  }

  async refresh(): Promise<void> {
    const result = await getWalkthrough();
    if (result) this.snapshot = result;
  }

  async complete(taskId: string): Promise<void> {
    this.adopt(await completeWalkthroughTask(taskId));
  }

  async uncomplete(taskId: string): Promise<void> {
    this.adopt(await uncompleteWalkthroughTask(taskId));
  }

  async completeAll(): Promise<void> {
    this.adopt(await completeAllWalkthroughTasks());
  }

  async setDismissed(dismissed: boolean): Promise<void> {
    this.adopt(await setWalkthroughDismissed(dismissed));
  }

  async reset(): Promise<void> {
    this.adopt(await resetWalkthrough());
  }

  private adopt(result: WalkthroughSnapshot | null): void {
    if (result) {
      this.snapshot = result;
    } else {
      logService.warn('Walkthrough command failed; keeping the previous state');
    }
  }
}

export const walkthroughService = new WalkthroughService();
