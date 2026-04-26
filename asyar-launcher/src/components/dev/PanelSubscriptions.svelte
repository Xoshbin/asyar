<script lang="ts">
  import { inspectorStore } from '../../services/dev/inspectorStore.svelte';
  import TimestampRelative from './TimestampRelative.svelte';

  const rows = $derived.by(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return [];
    const subs = inspectorStore.subsByExt[id] ?? [];
    return [...subs].sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return a.key.localeCompare(b.key);
    });
  });

  $effect(() => {
    const id = inspectorStore.selectedExtensionId;
    if (!id) return;
    void inspectorStore.refreshSubscriptions(id);
  });
</script>

<div class="subs-panel">
  {#if !inspectorStore.selectedExtensionId}
    <div class="empty">Select an extension from the sidebar.</div>
  {:else if rows.length === 0}
    <div class="empty">No active subscriptions.</div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Role</th>
          <th>Key</th>
          <th class="count-col">Listeners</th>
          <th class="ts-col">Installed</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.role + ':' + row.key)}
          <tr>
            <td><span class="role role-{row.role}">{row.role}</span></td>
            <td><code>{row.key}</code></td>
            <td class="count-col">{row.listenerCount}</td>
            <td class="ts-col"><TimestampRelative timestamp={row.installedAt} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .subs-panel {
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
  }
  .count-col {
    width: 80px;
    text-align: right;
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .ts-col {
    width: 90px;
    text-align: right;
  }
  code {
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-accent, #8ab4f8);
  }
  .role {
    display: inline-block;
    padding: 0 5px;
    border-radius: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .role-worker {
    background: #4a5d7e;
    color: #d6e4ff;
  }
  .role-view {
    background: #6b4a7e;
    color: #e4d6ff;
  }
</style>
