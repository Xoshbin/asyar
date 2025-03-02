<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Button from './Button.svelte';
  
  export let title: string = "Confirm Action";
  export let message: string = "Are you sure you want to continue?";
  export let confirmButtonText: string = "Confirm";
  export let cancelButtonText: string = "Cancel";
  export let isOpen: boolean = false;
  export let isDestructive: boolean = false;
  
  const dispatch = createEventDispatcher();
  
  function confirm() {
    dispatch('confirm');
    close();
  }
  
  function cancel() {
    dispatch('cancel');
    close();
  }
  
  function close() {
    isOpen = false;
  }
  
  // Close on Escape key
  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && isOpen) {
      cancel();
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div 
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    on:click|self={cancel}
  >
    <div 
      class="bg-[var(--bg-primary)] rounded-lg shadow-lg w-full max-w-md overflow-hidden transition-all transform"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
    >
      <div class="p-6">
        <h2 id="dialog-title" class="text-xl font-semibold mb-4 text-[var(--text-primary)]">
          {title}
        </h2>
        <p class="text-[var(--text-secondary)] mb-6">{message}</p>
        
        <div class="flex justify-end gap-3">
          <Button 
            on:click={cancel} 
          >
            {cancelButtonText}
          </Button>
          <Button 
            on:click={confirm} 
          >
            {confirmButtonText}
          </Button>
        </div>
      </div>
    </div>
  </div>
{/if}
