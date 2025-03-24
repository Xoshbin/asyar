<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Button from '../base/Button.svelte';
  
  export let actions: Array<{
    id: string;
    label: string;
    icon?: string;
    disabled?: boolean;
  }> = [];
  
  const dispatch = createEventDispatcher();
  
  function handleAction(actionId: string) {
    dispatch('action', { actionId });
  }
</script>

<div class="fixed bottom-0 left-0 right-0 border-t border-[var(--border-color)] z-20 px-4 py-2">
  <div class="flex items-center justify-end gap-3 max-w-3xl mx-auto">
    {#each actions as action}
      <Button class="border-none py-1 bg-transparent"
        on:click={() => handleAction(action.id)} 
        disabled={action.disabled}
      >
        {#if action.icon}
          <span class="mr-2">{action.icon}</span>
        {/if}
        {action.label}
      </Button>
    {/each}
  </div>
</div>

<!-- Add spacing below content to prevent it from being hidden behind the panel -->
<div class="h-14"></div>
