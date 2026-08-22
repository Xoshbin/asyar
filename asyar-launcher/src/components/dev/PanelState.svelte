<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
  import { inspectorStore } from '../../services/dev/inspectorStore.svelte';
  import JsonTree from './JsonTree.svelte';
  import TimestampRelative from './TimestampRelative.svelte';
  import { t } from '../../services/i18n';

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
    <EmptyState compact message={t('dev.select_extension')} />
  {:else if rows.length === 0}
    <EmptyState compact message={t('dev.no_state_rows')} />
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
    padding: var(--space-5);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-xs);
  }
  th {
    text-align: left;
    padding: var(--space-1) var(--space-3);
    border-bottom: 1px solid var(--border-color);
    font-size: var(--font-size-2xs);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
  }
  td {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-color);
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
    font-family: var(--font-mono);
    color: var(--accent-primary);
  }
</style>
