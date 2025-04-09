<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher<{
    // Add object_id to the event detail
    select: { item: { object_id: string; title: string; subtitle?: string; action: () => void } };
  }>();

  export let items: Array<{
    object_id: string; // Add object_id to the item type
    title: string;
    subtitle?: string;
    action: () => void;
  }> = [];
  export let selectedIndex = -1;
</script>

<div class="max-h-[calc(100vh-72px)]">
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
