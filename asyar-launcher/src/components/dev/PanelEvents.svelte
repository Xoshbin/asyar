<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
  import { inspectorStore, type EventRow } from '../../services/dev/inspectorStore.svelte';
  import StreamTail from './StreamTail.svelte';
  import { t } from '../../services/i18n';

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
    <button type="button" onclick={clear}>{t('common.clear')}</button>
  </div>

  {#if !inspectorStore.selectedExtensionId}
    <EmptyState compact message={t('dev.select_extension')} />
  {:else if rows.length === 0}
    <EmptyState compact message={t('dev.no_events')} />
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
    gap: var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
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
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-xs);
    color: var(--text-primary);
    cursor: pointer;
    padding: var(--space-0-5) var(--space-3);
    font-size: var(--font-size-xs);
  }
  .time {
    color: var(--text-secondary);
    margin-right: var(--space-2);
  }
  .name {
    color: var(--accent-primary);
    margin-right: var(--space-2);
  }
  .summary {
    color: var(--text-primary);
  }
</style>
