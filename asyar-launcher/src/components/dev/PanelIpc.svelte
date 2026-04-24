<script lang="ts">
  import { inspectorStore, type IpcTrace } from '../../services/dev/inspectorStore.svelte';
  import StreamTail from './StreamTail.svelte';

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
    <div class="empty">Select an extension from the sidebar.</div>
  {:else if rows.length === 0}
    <div class="empty">No IPC traffic yet.</div>
  {:else}
    <StreamTail rows={rows} tail={250}>
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
    gap: 12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #333);
    font-size: 11px;
    color: var(--color-text-muted, #999);
  }
  .toolbar button {
    margin-left: auto;
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
    margin-right: 8px;
  }
  .phase {
    display: inline-block;
    min-width: 54px;
    padding: 0 4px;
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    margin-right: 6px;
    text-align: center;
  }
  .phase.phase-invoke {
    background: rgba(120, 160, 255, 0.22);
    color: #8ab4f8;
  }
  .phase.phase-response {
    background: rgba(90, 220, 110, 0.2);
    color: #5adc6e;
  }
  .cmd {
    color: var(--color-text, #ddd);
    margin-right: 6px;
  }
  .ms {
    color: var(--color-text-muted, #aaa);
    font-variant-numeric: tabular-nums;
    margin-right: 6px;
  }
  .err {
    color: #f06464;
  }
</style>
