<script lang="ts">
  import { Badge, Icon } from '..';
  import { developmentBuildIndicator } from '../../lib/developmentBuild';

  let {
    tabs,
    activeTab = $bindable(),
  }: {
    tabs: { id: string; label: string; icon: string; badge?: string }[];
    activeTab: string;
  } = $props();
</script>

<div class="settings-top-bar">
  <div class="settings-tabs" role="tablist">
    {#each tabs as tab}
      <button
        class="tab-item"
        class:active={activeTab === tab.id}
        role="tab"
        aria-selected={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}
      >
        <div class="icon-container">
          <Icon name={tab.icon} size={22} />
        </div>
        <span class="label">{tab.label}</span>
      </button>
    {/each}
  </div>
  {#if developmentBuildIndicator}
    <span
      class="development-build-indicator"
      title={developmentBuildIndicator.title}
      aria-label={developmentBuildIndicator.title}
    >
      <Badge text={developmentBuildIndicator.text} variant="warning" mono bordered />
    </span>
  {/if}
</div>

<style>
  .settings-top-bar {
    position: relative;
    padding: var(--space-4) var(--space-6);
    border-bottom: 1px solid var(--separator);
    background: var(--bg-primary);
  }

  .settings-tabs {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--space-2);
  }

  .development-build-indicator {
    position: absolute;
    inset-inline-end: var(--space-4);
    top: 50%;
    transform: translateY(-50%);
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
