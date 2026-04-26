<script lang="ts">
  import { inspectorStore } from '../../services/dev/inspectorStore.svelte';
  import JsonTree from './JsonTree.svelte';
  import TimestampRelative from './TimestampRelative.svelte';

  const rows = $derived.by(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return [];
    const entries = inspectorStore.stateByExt[id] ?? [];
    return [...entries].sort((a, b) => a.key.localeCompare(b.key));
  });

  // Fetch on selection change. Svelte's reactivity graph picks up the
  // selectedExtensionId dependency via $effect — keep the load in an
  // effect so tab-switching also triggers a refresh if the panel is
  // remounted.
  $effect(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return;
    void inspectorStore.refreshState(id);
  });
</script>

<div class="state-panel">
  {#if !inspectorStore.selectedExtensionId}
    <div class="empty">Select an extension from the sidebar.</div>
  {:else if rows.length === 0}
    <div class="empty">No state rows for this extension.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th class="key-col">Key</th>
          <th>Value</th>
          <th class="ts-col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.key)}
          <tr>
            <td class="key-col"><code>{row.key}</code></td>
            <td><JsonTree value={row.value} /></td>
            <td class="ts-col"><TimestampRelative timestamp={row.updatedAt} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .state-panel {
    padding: 12px;
  }
  .empty {
    color: var(--color-text-muted, #888);
    font-style: italic;
    font-size: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th {
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid var(--color-border, #333);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted, #888);
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--color-border, #2a2a2a);
    vertical-align: top;
  }
  .key-col {
    width: 140px;
    white-space: nowrap;
  }
  .ts-col {
    width: 90px;
    text-align: right;
  }
  code {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-accent, #8ab4f8);
  }
</style>
