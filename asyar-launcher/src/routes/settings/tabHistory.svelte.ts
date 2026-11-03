import type { SettingsTabId } from './settingsNav';

/**
 * Browser-style history of visited Settings tabs, driving the `‹ ›` pill at
 * the top of every tab. Drill-downs inside a tab keep their own `DrillState`.
 */
export class TabHistory {
  private entries = $state<SettingsTabId[]>([]);
  private index = $state(-1);

  canBack = $derived(this.index > 0);
  canForward = $derived(this.index < this.entries.length - 1);

  /** Record a visit. A no-op when `tab` is already the current entry. */
  visit(tab: SettingsTabId): void {
    if (this.entries[this.index] === tab) return;
    this.entries = [...this.entries.slice(0, this.index + 1), tab];
    this.index = this.entries.length - 1;
  }

  back(): SettingsTabId | null {
    if (!this.canBack) return null;
    this.index -= 1;
    return this.entries[this.index];
  }

  forward(): SettingsTabId | null {
    if (!this.canForward) return null;
    this.index += 1;
    return this.entries[this.index];
  }
}
