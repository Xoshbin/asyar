<script lang="ts">
  import { Icon } from '../index';

  let {
    tabs,
    activeTab = $bindable(),
  }: {
    tabs: { id: string; label: string; icon: string; badge?: string }[];
    activeTab: string;
  } = $props();
</script>

<div class="settings-top-bar" role="tablist">
  {#each tabs as tab}
    <button
      class="tab-item"
      class:active={activeTab === tab.id}
      role="tab"
      aria-selected={activeTab === tab.id}
      onclick={() => activeTab = tab.id}
    >
      <div class="icon-container">
        <Icon name={tab.icon} size={22} />
      </div>
      <span class="label">{tab.label}</span>
    </button>
  {/each}
</div>

<style>
  .settings-top-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--separator);
    background: var(--bg-primary);
  }

  .tab-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-5);
    cursor: pointer;
    border: none;
    background: transparent;
    transition: background-color var(--transition-normal);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
  }

  .tab-item:hover {
    background: var(--bg-hover);
  }

  .tab-item.active {
    color: var(--text-primary);
  }

  .icon-container {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    background: transparent;
    transition: background-color var(--transition-normal);
  }

  .tab-item.active .icon-container {
    background: var(--bg-selected);
  }

  .label {
    font-size: var(--font-size-xs);
    font-weight: 600;
    font-family: var(--font-ui);
  }
</style>
