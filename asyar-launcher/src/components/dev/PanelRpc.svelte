<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
  import { inspectorStore, type RpcTrace } from '../../services/dev/inspectorStore.svelte';
  import { t } from '../../services/i18n';

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
    <EmptyState compact message={t('dev.select_extension')} />
  {:else if traces.length === 0}
    <EmptyState compact message={t('dev.no_rpc')} />
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
    gap: var(--space-5);
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }
  .toolbar span {
    font-variant-numeric: tabular-nums;
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
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
    table-layout: fixed;
  }
  th,
  td {
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border-color);
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  th {
    font-size: var(--font-size-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  .cid {
    width: 130px;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  code {
    font-family: var(--font-mono);
    color: var(--accent-primary);
  }
  .badge {
    display: inline-block;
    padding: 0 var(--space-1-5);
    border: 1px solid transparent;
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge.phase-request {
    background: color-mix(in srgb, var(--accent-warning) 25%, transparent);
    color: var(--accent-warning);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .badge.phase-resolved {
    background: color-mix(in srgb, var(--accent-success) 20%, transparent);
    color: var(--accent-success);
  }
  .badge.phase-rejected {
    background: color-mix(in srgb, var(--accent-danger) 25%, transparent);
    color: var(--accent-danger);
  }
  /* A timeout is a failure too, so it stays in the danger hue — the outline
     is what separates "we gave up waiting" from "the call was rejected". */
  .badge.phase-timeout {
    background: transparent;
    border-color: color-mix(in srgb, var(--accent-danger) 50%, transparent);
    color: var(--accent-danger);
  }
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
</style>
