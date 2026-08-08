import { rankItems } from '../../lib/rankItems';
import { walkthroughService } from '../../services/walkthrough/walkthroughService.svelte';
import type { WalkthroughTaskView } from '../../lib/ipc/walkthroughCommands';

export type WalkthroughMode = 'list' | 'detail';

/**
 * View state for the Walkthrough list and its task detail page.
 *
 * Ordering and completion belong to Rust; this only decides what is on
 * screen and which row has focus. Text filtering also goes to Rust, through
 * the shared `rank_items` ranker.
 */
class WalkthroughViewState {
  mode = $state<WalkthroughMode>('list');
  searchQuery = $state('');
  selectedIndex = $state(0);
  openTaskId = $state<string | null>(null);

  /** Ids from the last Rust ranking pass; null means "no active filter". */
  private rankedIds = $state<string[] | null>(null);

  /** Unfinished tasks first — the list should open on what is left to do. */
  visible: WalkthroughTaskView[] = $derived.by(() => {
    const all = walkthroughService.tasks;
    const filtered =
      this.rankedIds === null
        ? all
        : this.rankedIds
            .map((id) => all.find((t) => t.id === id))
            .filter((t): t is WalkthroughTaskView => t !== undefined);

    return [...filtered.filter((t) => !t.completed), ...filtered.filter((t) => t.completed)];
  });

  selected: WalkthroughTaskView | null = $derived(this.visible[this.selectedIndex] ?? null);

  openTask: WalkthroughTaskView | null = $derived(
    this.openTaskId === null
      ? null
      : (walkthroughService.tasks.find((t) => t.id === this.openTaskId) ?? null),
  );

  async setSearch(query: string): Promise<void> {
    this.searchQuery = query;
    this.selectedIndex = 0;

    const q = query.trim();
    if (!q) {
      this.rankedIds = null;
      return;
    }

    const ranked = await rankItems(q, walkthroughService.tasks, {
      id: (t) => t.id,
      title: (t) => t.title,
      subtitle: (t) => t.summary,
    });

    // A newer keystroke may have superseded this query mid-flight.
    if (this.searchQuery.trim() !== q) return;
    this.rankedIds = ranked.map((t) => t.id);
  }

  move(delta: number): void {
    const len = this.visible.length;
    if (len === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;
  }

  /** Enter on a row opens its detail page. */
  open(taskId?: string): void {
    const id = taskId ?? this.selected?.id;
    if (!id) return;
    this.openTaskId = id;
    this.mode = 'detail';
  }

  /** Esc/Backspace in the detail page returns to the list, keeping focus. */
  back(): boolean {
    if (this.mode !== 'detail') return false;
    this.mode = 'list';
    this.openTaskId = null;
    return true;
  }

  reset(): void {
    this.mode = 'list';
    this.searchQuery = '';
    this.selectedIndex = 0;
    this.openTaskId = null;
    this.rankedIds = null;
  }
}

export const walkthroughViewState = new WalkthroughViewState();
