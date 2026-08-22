<script lang="ts">
  import EmptyState from '../feedback/EmptyState.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { t } from '../../services/i18n';

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

<nav class="ext-nav custom-scrollbar" aria-label="Extensions">
  <div class="nav-header">Extensions</div>
  {#if items.length === 0}
    <EmptyState compact message={t('dev.no_enabled_extensions')} />
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
    padding: var(--space-4) var(--space-5) var(--space-2);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary);
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
    gap: var(--space-2);
    padding: var(--space-2) var(--space-5);
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    text-align: left;
    cursor: pointer;
  }
  .nav-row:hover {
    background: var(--bg-hover);
  }
  .nav-row.selected {
    background: var(--bg-selected);
    color: var(--accent-primary);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .roles {
    display: flex;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .role-badge {
    display: inline-block;
    min-width: 14px;
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 700;
    text-align: center;
    line-height: 14px;
  }
  .role-badge.w {
    background: color-mix(in srgb, var(--accent-primary) 30%, transparent);
    color: var(--accent-primary);
  }
  .role-badge.v {
    background: var(--asyar-brand-muted);
    color: var(--asyar-brand);
  }
</style>
