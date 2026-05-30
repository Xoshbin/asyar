import { HELP_TOPICS, filterTopics, type HelpTopic } from './topics';

/** Reactive state for the Help view: search query + keyboard selection. */
class HelpViewState {
  query = $state('');
  selectedIndex = $state(0);

  filtered: HelpTopic[] = $derived(filterTopics(HELP_TOPICS, this.query));
  selected: HelpTopic | null = $derived(this.filtered[this.selectedIndex] ?? null);

  setSearch(query: string): void {
    this.query = query;
    this.selectedIndex = 0;
  }

  move(delta: number): void {
    const len = this.filtered.length;
    if (len === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;
  }

  reset(): void {
    this.query = '';
    this.selectedIndex = 0;
  }
}

export const helpViewState = new HelpViewState();
