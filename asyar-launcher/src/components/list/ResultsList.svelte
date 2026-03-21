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
    typeLabel?: string;
    icon?: string;
    style?: "default" | "large";
    action: () => void;
  }> = [];
  export let selectedIndex = -1;
</script>

<div class="max-h-[calc(100vh-72px)] p-2">
  {#each items as item, i}
    <button
      type="button"
      data-index={i}
      class="result-item {item.style === 'large' ? 'calc-large-item' : ''}"
      class:selected-result={i === selectedIndex}
      on:click={() => {
        console.log('[ResultsList] Item clicked:', item.object_id);
        dispatch('select', { item });
      }}
    >
      {#if item.style === 'large'}
        <div class="flex items-center gap-4 w-full px-2 py-4">
          {#if item.icon}
            {#if item.icon.startsWith('data:image')}
                <img
                    src={item.icon}
                    alt={item.title}
                    class="flex-shrink-0 w-12 h-12 rounded-xl object-contain shadow-sm border border-[var(--separator)]"
                />
            {:else}
                <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-xl bg-[var(--accent-primary)]/10 text-2xl shadow-sm border border-[var(--separator)]">
                   {item.icon}
                </div>
            {/if}
          {/if}
          <div class="flex flex-col items-start flex-1 overflow-hidden">
             <div class="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider mb-1">{item.subtitle || 'Calculator'}</div>
             <div class="text-3xl font-light text-[var(--text-primary)] truncate break-all leading-tight w-full text-left">{item.title}</div>
          </div>
        </div>
      {:else}
        <div class="flex items-center gap-3 py-1 w-full">
          {#if item.icon}
            {#if item.icon.startsWith('data:image')}
              <img
                src={item.icon}
                alt={item.title}
                class="w-6 h-6 rounded-md object-contain flex-shrink-0"
              />
            {:else}
              <div class="w-6 text-center text-[var(--text-secondary)] flex-shrink-0">
                {item.icon}
              </div>
            {/if}
          {/if}

          <!-- Left: name + optional inline description -->
          <div class="flex-1 flex items-baseline gap-2 min-w-0">
            <span class="result-title truncate">{item.title}</span>
            {#if item.subtitle}
              <span class="text-xs text-[var(--text-tertiary)] truncate flex-shrink">{item.subtitle}</span>
            {/if}
          </div>

          <!-- Right: type label -->
          {#if item.typeLabel}
            <span class="text-xs text-[var(--text-tertiary)] flex-shrink-0 ml-2">{item.typeLabel}</span>
          {/if}
        </div>
      {/if}
    </button>
  {/each}
</div>

<style>
  .calc-large-item {
    border: none;
    border-radius: 0.75rem;
    margin-bottom: 0.5rem;
    transition-property: all;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    transition-duration: 200ms;
    background-color: var(--bg-secondary);
    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
  }
  .calc-large-item:hover {
     box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);
     transform: scale(1.01);
  }
  .calc-large-item.selected-result {
     box-shadow: 0 0 0 2px var(--accent-primary), 0 8px 25px rgba(0, 122, 255, 0.15);
     background-color: var(--bg-hover);
  }
</style>
