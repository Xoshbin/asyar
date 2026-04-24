<script lang="ts">
  import { inspectorStore, type RpcTrace } from '../../services/dev/inspectorStore.svelte';

  const traces = $derived.by(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return [];
    const bucket = inspectorStore.rpcByExt[id] ?? {};
    return Object.values(bucket).sort((a, b) => b.startedAt - a.startedAt);
  });

  function phaseClass(phase: RpcTrace['phase']): string {
    return `phase-${phase}`;
  }

  function formatTime(ms: number): string {
    const d = new Date(ms);
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function clear() {
    const id = inspectorStore.selectedExtensionId;
    if (id) inspectorStore.clearRpc(id);
  }
</script>

<div class="rpc-panel">
  <div class="toolbar">
    <span>{traces.length} RPCs</span>
    <button type="button" onclick={clear}>Clear</button>
  </div>

  {#if !inspectorStore.selectedExtensionId}
    <div class="empty">Select an extension from the sidebar.</div>
  {:else if traces.length === 0}
    <div class="empty">No RPC activity. Make sure the dev flag is active (reload extension).</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Start</th>
          <th>ID</th>
          <th class="cid">Correlation</th>
          <th>Phase</th>
          <th class="num">Elapsed</th>
        </tr>
      </thead>
      <tbody>
        {#each traces as t (t.correlationId)}
          <tr class={phaseClass(t.phase)}>
            <td>{formatTime(t.startedAt)}</td>
            <td><code>{t.id ?? '—'}</code></td>
            <td class="cid"><code>{t.correlationId.slice(0, 12)}…</code></td>
            <td><span class="badge phase-{t.phase}">{t.phase}</span></td>
            <td class="num">{t.elapsedMs != null ? `${t.elapsedMs}ms` : '…'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .rpc-panel {
    padding: 0;
    display: flex;
    flex-direction: column;
    height: 100%;
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
  .toolbar span {
    font-variant-numeric: tabular-nums;
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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    table-layout: fixed;
  }
  th,
  td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--color-border, #2a2a2a);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  th {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #888);
  }
  .cid {
    width: 130px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  code {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-accent, #8ab4f8);
  }
  .badge {
    display: inline-block;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .badge.phase-request {
    background: rgba(255, 190, 90, 0.25);
    color: #ffbe5a;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .badge.phase-resolved {
    background: rgba(90, 220, 110, 0.2);
    color: #5adc6e;
  }
  .badge.phase-rejected {
    background: rgba(240, 100, 100, 0.25);
    color: #f06464;
  }
  .badge.phase-timeout {
    background: rgba(240, 140, 60, 0.25);
    color: #f08c3c;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }
</style>
