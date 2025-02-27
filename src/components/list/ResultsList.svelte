<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{
    select: { item: { title: string; subtitle?: string; action: () => void } };
  }>();

  export let items: Array<{ 
    title: string; 
    subtitle?: string;
    action: () => void;
  }> = [];
  export let selectedIndex = -1;
</script>

<div class="max-h-[calc(100vh-72px)] overflow-y-auto">
  {#each items as item, i}
    <button
      type="button"
      data-index={i}
      class="result-item"
      class:selected-result={i === selectedIndex}
      on:click={() => dispatch('select', { item })}
    >
      <div class="result-title">{item.title}</div>
      {#if item.subtitle}
        <div class="result-subtitle">{item.subtitle}</div>
      {/if}
    </button>
  {/each}
</div>
