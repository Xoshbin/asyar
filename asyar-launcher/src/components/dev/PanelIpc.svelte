<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
  import { inspectorStore, type IpcTrace } from '../../services/dev/inspectorStore.svelte';
  import StreamTail from './StreamTail.svelte';
  import { t } from '../../services/i18n';

  const rows = $derived.by(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return [] as (IpcTrace & { id: number })[];
    const arr = inspectorStore.ipcByExt[id] ?? [];
    return arr.map((t) => ({ ...t, id: t.seq }));
  });

  function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function clear() {
    const id = inspectorStore.selectedExtensionId;
    if (id) inspectorStore.clearIpc(id);
  }
</script>

<div class="ipc-panel">
  <div class="toolbar">
    <span>{rows.length} records</span>
    <button type="button" onclick={clear}>Clear</button>
  </div>

  {#if !inspectorStore.selectedExtensionId}
    <EmptyState compact message={t('dev.select_extension')} />
  {:else if rows.length === 0}
    <EmptyState compact message={t('dev.no_ipc')} />
  {:else}
    <StreamTail {rows} tail={250}>
      {#snippet row(item)}
        <span class="time">{formatTime(item.timestamp)}</span>
        <span class="phase phase-{item.phase}">{item.phase}</span>
        <span class="cmd">{item.command}</span>
        {#if item.elapsedMs != null}
          <span class="ms">{item.elapsedMs}ms</span>
        {/if}
        {#if item.error}
          <span class="err">✗ {item.error}</span>
        {/if}
      {/snippet}
    </StreamTail>
  {/if}
</div>

<style>
  .ipc-panel {
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
  .toolbar button {
    margin-left: auto;
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
    margin-right: var(--space-3);
  }
  .phase {
    display: inline-block;
    min-width: 54px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    font-size: var(--font-size-2xs);
    font-weight: 700;
    text-transform: uppercase;
    margin-right: var(--space-2);
    text-align: center;
  }
  .phase.phase-invoke {
    background: color-mix(in srgb, var(--accent-primary) 22%, transparent);
    color: var(--accent-primary);
  }
  .phase.phase-response {
    background: color-mix(in srgb, var(--accent-success) 20%, transparent);
    color: var(--accent-success);
  }
  .cmd {
    color: var(--text-primary);
    margin-right: var(--space-2);
  }
  .ms {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    margin-right: var(--space-2);
  }
  .err {
    color: var(--accent-danger);
  }
</style>
