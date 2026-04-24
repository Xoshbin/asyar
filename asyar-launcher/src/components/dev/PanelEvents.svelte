<script lang="ts">
  import { inspectorStore, type EventRow } from '../../services/dev/inspectorStore.svelte';
  import StreamTail from './StreamTail.svelte';

  let paused = $state(false);
  let frozen = $state<EventRow[]>([]);

  // Freeze a snapshot of the live buffer when Pause flips on. The buffer
  // keeps collecting in the store — we just stop reacting.
  $effect(() => {
    if (paused) {
      const id = inspectorStore.selectedExtensionId;
      if (!id) {
        frozen = [];
        return;
      }
      frozen = [...(inspectorStore.eventsByExt[id] ?? [])];
    }
  });

  const rows = $derived.by(() => {
    if (paused) return frozen;
    const id = inspectorStore.selectedExtensionId;
    if (!id) return [];
    return inspectorStore.eventsByExt[id] ?? [];
  });

  function formatTime(ms: number): string {
    const d = new Date(ms);
    const s = d.toTimeString().slice(0, 8);
    return `${s}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  }

  function summary(row: EventRow): string {
    const p = row.payload as Record<string, unknown> | null | undefined;
    if (!p || typeof p !== 'object') return '';
    const parts: string[] = [];
    if (typeof p.key === 'string') parts.push(`key=${p.key}`);
    if (typeof p.role === 'string') parts.push(`role=${p.role}`);
    if (typeof p.reason === 'string') parts.push(`reason=${p.reason}`);
    if (typeof p.correlationId === 'string') parts.push(`cid=${p.correlationId.slice(0, 8)}`);
    return parts.join(' ');
  }

  function clear() {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return;
    inspectorStore.clearEvents(id);
    if (paused) frozen = [];
  }
</script>

<div class="events-panel">
  <div class="toolbar">
    <label>
      <input type="checkbox" bind:checked={paused} />
      Pause display
    </label>
    <span class="count">{rows.length} events{paused ? ' (frozen)' : ''}</span>
    <button type="button" onclick={clear}>Clear</button>
  </div>

  {#if !inspectorStore.selectedExtensionId}
    <div class="empty">Select an extension from the sidebar.</div>
  {:else if rows.length === 0}
    <div class="empty">No events yet.</div>
  {:else}
    <StreamTail {rows}>
      {#snippet row(item)}
        <span class="time">{formatTime(item.timestamp)}</span>
        <span class="name">{item.eventName}</span>
        <span class="summary">{summary(item)}</span>
      {/snippet}
    </StreamTail>
  {/if}
</div>

<style>
  .events-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #333);
    font-size: 11px;
    color: var(--color-text-muted, #999);
  }
  .toolbar label {
    cursor: pointer;
    user-select: none;
  }
  .toolbar .count {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .toolbar button {
    background: var(--color-surface-3, #222);
    border: 1px solid var(--color-border, #444);
    border-radius: 3px;
    color: var(--color-text, #ddd);
    cursor: pointer;
    padding: 2px 8px;
    font-size: 11px;
  }
  .empty {
    padding: 16px;
    font-style: italic;
    color: var(--color-text-muted, #888);
  }
  .time {
    color: var(--color-text-muted, #888);
    margin-right: 6px;
  }
  .name {
    color: var(--color-text-accent, #8ab4f8);
    margin-right: 6px;
  }
  .summary {
    color: var(--color-text, #ddd);
  }
</style>
