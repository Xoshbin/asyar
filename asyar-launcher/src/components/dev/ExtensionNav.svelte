<script lang="ts">
  import extensionManager from '../../services/extension/extensionManager.svelte';

  type Props = {
    selectedId: string | null;
    onselect: (id: string) => void;
  };

  let { selectedId, onselect }: Props = $props();

  const items = $derived(
    extensionManager.extensionRecords
      .filter((r) => r.enabled)
      .map((r) => ({
        id: r.manifest.id,
        name: r.manifest.name ?? r.manifest.id,
        hasView: Array.isArray((r.manifest as { views?: unknown[] }).views)
          ? ((r.manifest as { views?: unknown[] }).views as unknown[]).length > 0
          : false,
        hasWorker: !!(r.manifest as { background?: { main?: string } }).background?.main,
      })),
  );
</script>

<nav class="ext-nav" aria-label="Extensions">
  <div class="nav-header">Extensions</div>
  {#if items.length === 0}
    <div class="empty">No enabled extensions</div>
  {:else}
    <ul>
      {#each items as item (item.id)}
        <li>
          <button
            type="button"
            class="nav-row"
            class:selected={selectedId === item.id}
            onclick={() => onselect(item.id)}
          >
            <span class="name">{item.name}</span>
            <span class="roles">
              {#if item.hasWorker}<span class="role-badge w" title="worker">W</span>{/if}
              {#if item.hasView}<span class="role-badge v" title="view">V</span>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .ext-nav {
    display: flex;
    flex-direction: column;
    min-width: 0;
    height: 100%;
    overflow-y: auto;
  }
  .nav-header {
    padding: 10px 12px 6px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-text-muted, #888);
  }
  .empty {
    padding: 12px;
    font-size: 12px;
    color: var(--color-text-muted, #888);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .nav-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: var(--color-text, #ddd);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .nav-row:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.04));
  }
  .nav-row.selected {
    background: var(--color-surface-active, rgba(100, 150, 255, 0.12));
    color: var(--color-text-accent, #8ab4f8);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .roles {
    display: flex;
    gap: 3px;
    flex-shrink: 0;
  }
  .role-badge {
    display: inline-block;
    min-width: 14px;
    padding: 0 3px;
    border-radius: 3px;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 9px;
    font-weight: 700;
    text-align: center;
    line-height: 14px;
  }
  .role-badge.w {
    background: #4a5d7e;
    color: #d6e4ff;
  }
  .role-badge.v {
    background: #6b4a7e;
    color: #e4d6ff;
  }
</style>
