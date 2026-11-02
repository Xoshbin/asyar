/**
 * Browser-style drill-down state for the list tabs (Built-in Features,
 * Extensions). Lives with the tab component, so switching sidebar tabs
 * unmounts it and resets the drill naturally.
 */
export class DrillState {
  id = $state<string | null>(null);
  commandId = $state<string | null>(null);
  private forwardTarget = $state<{ id: string; commandId: string | null } | null>(null);

  canBack = $derived(this.id !== null);
  canForward = $derived(this.id === null && this.forwardTarget !== null);

  into(id: string, commandId: string | null = null): void {
    this.id = id;
    this.commandId = commandId;
    this.forwardTarget = null;
  }

  back(): void {
    if (this.id === null) return;
    this.forwardTarget = { id: this.id, commandId: this.commandId };
    this.id = null;
    this.commandId = null;
  }

  /** Drop the drill without recording a forward target (e.g. the item vanished). */
  reset(): void {
    this.id = null;
    this.commandId = null;
  }

  forward(): void {
    if (!this.forwardTarget) return;
    this.id = this.forwardTarget.id;
    this.commandId = this.forwardTarget.commandId;
    this.forwardTarget = null;
  }
}
