<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
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
    <EmptyState compact message="Select an extension from the sidebar." />
  {:else if rows.length === 0}
    <EmptyState compact message="No active subscriptions." />
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
  }
  .count-col {
    width: 80px;
    text-align: right;
    font-family: var(--font-mono);
  }
  .ts-col {
    width: 90px;
    text-align: right;
  }
  code {
    font-family: var(--font-mono);
    color: var(--accent-primary);
  }
  .role {
    display: inline-block;
    padding: 0 var(--space-1-5);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
  }
  .role-worker {
    background: color-mix(in srgb, var(--accent-primary) 30%, transparent);
    color: var(--accent-primary);
  }
  .role-view {
    background: var(--asyar-brand-muted);
    color: var(--asyar-brand);
  }
</style>
