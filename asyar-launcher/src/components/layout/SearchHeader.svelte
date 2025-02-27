<script lang="ts">
  import Input from '../base/Input.svelte';
  import { createEventDispatcher } from 'svelte';
  
  export let value = "";
  export let showBack: boolean = false;
  export let searchable = true;
  export let placeholder = "Search...";
  export let ref: HTMLInputElement | null = null;
  
  const dispatch = createEventDispatcher();
  
  function handleBackClick() {
    dispatch('click');
  }
</script>

<div class="search-header">
  <div class="relative w-full border-b-[0.5px] border-gray-400/20">
    {#if showBack}
      <div 
        class="back-button" 
        on:click={handleBackClick} 
        title="Press Escape to go back">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        <kbd class="keyboard-shortcut">Esc</kbd>
      </div>
    {/if}

    <input
      bind:this={ref}
      type="text"
      {placeholder}
      disabled={!searchable}
      bind:value
      autocomplete="off"
      spellcheck="false"
      class="search-input"
      class:pl-20={showBack}
      on:input
      on:keydown
    />
  </div>
</div>
