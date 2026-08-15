<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    tabs,
    activeTab = $bindable(''),
    variant = 'pills',
  }: {
    tabs: { id: string; label: string; icon?: string; count?: string }[];
    activeTab: string;
    variant?: 'pills' | 'sidebar' | 'underline';
  } = $props();
</script>

<!-- Tab semantics are scoped to the `sidebar` variant, which replaced the old
     role="tablist" settings top bar. The pills/underline variants keep their
     previous plain-button markup — `undefined` attributes do not render. -->
<nav
  class="tab-group"
  class:tab-group--pills={variant === 'pills'}
  class:tab-group--sidebar={variant === 'sidebar'}
  class:tab-group--underline={variant === 'underline'}
  role={variant === 'sidebar' ? 'tablist' : undefined}
>
  {#each tabs as tab}
    <button
      class="tab-item"
      class:active={activeTab === tab.id}
      onclick={() => (activeTab = tab.id)}
      role={variant === 'sidebar' ? 'tab' : undefined}
      aria-selected={variant === 'sidebar' ? activeTab === tab.id : undefined}
    >
      {#if variant === 'sidebar' && tab.icon}
        <span class="tab-item-icon"><Icon name={tab.icon} size={16} /></span>
      {/if}
      <span class="tab-item-label">{tab.label}</span>
      {#if variant === 'sidebar' && tab.count}
        <span class="tab-item-count">{tab.count}</span>
      {/if}
    </button>
  {/each}
</nav>

<style>
  /* ── Pills variant (horizontal, rounded) ──────────── */
  .tab-group--pills {
    display: flex;
    gap: var(--space-3);
    border-bottom: 1px solid var(--separator);
    padding-bottom: var(--space-6);
    overflow-x: auto;
  }

  .tab-group--pills .tab-item {
    padding: var(--space-4) var(--space-7);
    border-radius: var(--radius-full);
    font-size: var(--font-size-md);
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: all var(--transition-smooth);
    transform: scale(1);
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    font-family: var(--font-ui);
  }

  .tab-group--pills .tab-item:hover {
    background: var(--bg-hover);
    transform: scale(1.05);
  }

  .tab-group--pills .tab-item:active {
    transform: scale(0.95);
  }

  .tab-group--pills .tab-item.active {
    background: var(--accent-primary-fill);
    color: var(--text-on-accent);
    box-shadow: 0 4px 6px -1px color-mix(in srgb, var(--accent-primary) 20%, transparent);
  }

  /* ── Sidebar variant (vertical, icon + label + count) ─ */
  .tab-group--sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .tab-group--sidebar .tab-item {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    padding: var(--space-4) var(--space-5);
    text-align: left;
    border-radius: var(--radius-md);
    font-weight: 500;
    font-size: var(--font-size-md);
    border: none;
    cursor: pointer;
    background: transparent;
    color: var(--text-secondary);
    font-family: var(--font-ui);
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .tab-group--sidebar .tab-item:hover {
    background: var(--bg-hover);
  }

  .tab-group--sidebar .tab-item.active {
    background: var(--bg-selected);
    color: var(--text-primary);
    font-weight: 600;
  }

  .tab-group--sidebar .tab-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    flex-shrink: 0;
    opacity: 0.9;
  }

  .tab-group--sidebar .tab-item-label {
    flex: 1;
    min-width: 0;
  }

  .tab-group--sidebar .tab-item-count {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  /* ── Underline variant (horizontal, accent bar under active) ─ */
  .tab-group--underline {
    display: flex;
    border-bottom: 1px solid var(--border-color);
  }

  .tab-group--underline .tab-item {
    padding: var(--space-2) var(--space-4);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    font-family: var(--font-ui);
    transition:
      color var(--transition-fast),
      border-color var(--transition-fast);
  }

  .tab-group--underline .tab-item:hover {
    color: var(--text-primary);
  }

  .tab-group--underline .tab-item.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent-primary);
    font-weight: 500;
  }
</style>
