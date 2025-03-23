<script lang="ts">
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();
  
  export let items = [];
  export let selectedIndex = -1;

  function handleClick(item) {
    dispatch("select", { item });
  }

  // Format the usage count into a user-friendly string
  function formatUsage(count: number, isRecent: boolean): string {
    if (!count || count < 2) {
      return isRecent ? '(Recently used)' : '';
    }
    
    if (isRecent) {
      return count < 5 ? '(Recently used)' : '(Used frequently)';
    } else {
      return count < 5 ? '(Used recently)' : (count < 10 ? '(Used frequently)' : '(Used often)');
    }
  }
</script>

<div class="results-container">
  {#each items as item, i}
    <div
      class="result-item {selectedIndex === i ? 'selected' : ''}"
      data-index={i}
      on:click={() => handleClick(item)}
      tabindex="0"
      role="button"
      aria-selected={selectedIndex === i}
    >
      {#if item.icon}
        <div class="result-icon">{item.icon}</div>
      {/if}
      <div class="result-content">
        <div class="result-title">
          {item.title}
          {#if item.usageCount > 1 || item.recentlyUsed}
            <span class="usage-badge" title="Used {item.usageCount || 0} times">
              {formatUsage(item.usageCount, item.recentlyUsed)}
            </span>
          {/if}
        </div>
        <div class="result-subtitle">{item.subtitle}</div>
      </div>
    </div>
  {/each}
</div>

<style>
  .results-container {
    width: 100%;
    padding: 0.5rem;
  }

  .result-item {
    display: flex;
    align-items: center;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s;
    margin-bottom: 0.3rem;
  }

  .result-item:hover {
    background-color: var(--bg-hover, rgba(150, 150, 150, 0.1));
  }

  .result-item.selected {
    background-color: var(--bg-selected, rgba(100, 100, 100, 0.2));
  }

  .result-icon {
    min-width: 24px;
    margin-right: 12px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .result-content {
    flex: 1;
    overflow: hidden;
  }

  .result-title {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;
    align-items: center;
  }

  .result-subtitle {
    font-size: 0.85rem;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .usage-badge {
    font-size: 0.7em;
    opacity: 0.7;
    margin-left: 5px;
    font-style: italic;
    color: var(--text-accent, #60a5fa);
  }
</style>