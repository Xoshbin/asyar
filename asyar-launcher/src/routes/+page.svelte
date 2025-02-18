<script lang="ts">
  import { onMount } from 'svelte';
  import ApplicationsService from '../services/applicationsService';
  import type { AppResult } from '../types';
  import { LogService } from '../services/logService';

  let searchQuery = '';
  let filteredApplications: AppResult[] = [];
  let selectedIndex = 0;
  let listContainer: HTMLDivElement;

  $: (async () => {
    filteredApplications = await ApplicationsService.search(searchQuery);
    selectedIndex = 0;
  })();

  async function handleSearch() {
    filteredApplications = await ApplicationsService.search(searchQuery);
    selectedIndex = 0;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = (selectedIndex + 1) % filteredApplications.length;
      ensureSelectedInView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = selectedIndex - 1 < 0 
        ? filteredApplications.length - 1 
        : selectedIndex - 1;
      ensureSelectedInView();
    } else if (event.key === 'Enter' && filteredApplications.length > 0) {
      const selectedApp = filteredApplications[selectedIndex];
      ApplicationsService.open(selectedApp);
    }
  }

  function ensureSelectedInView() {
    const selectedElement = listContainer?.querySelector(`[data-index="${selectedIndex}"]`);
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest' });
    }
  }

  onMount(async () => {
    await ApplicationsService.refreshCache();
    filteredApplications = await ApplicationsService.search('');
  });
</script>

<div class="fixed inset-x-0 top-0 z-50">
  <div class="w-full relative border-b-[0.5px] border-gray-400/20">
    <!-- svelte-ignore a11y_autofocus -->
    <input
      type="text"
      autoComplete="off"
      spellCheck={false}
      autofocus
      placeholder="Search or type a command..."
      class="w-full text-white text-lg outline-none placeholder-gray-400 px-8 py-5"
      bind:value={searchQuery}
      on:input={handleSearch}
      on:keydown={handleKeydown}
    />
    <div class="absolute right-6 top-1/2 -translate-y-1/2">
      <kbd class="px-2.5 py-1.5 text-xs text-gray-400 rounded">⌘K</kbd>
    </div>
  </div>
</div>

<div class="pt-[72px] min-h-screen">
  <div class="w-full overflow-hidden">
    <div class="max-h-[calc(100vh-72px)] overflow-y-auto" bind:this={listContainer}>
      <div class="category-section">
        {#each filteredApplications as app, i}
          <button
            type="button"
            data-index={i}
            class="w-full text-left px-8 py-4 flex flex-col gap-1.5 cursor-pointer transition-colors border-b-[0.5px] border-gray-700/20 last:border-0 hover:bg-gray-700/10 {i === selectedIndex ? 'bg-gray-700/20' : ''}"
            on:click={() => ApplicationsService.open(app)}
          >
            <div class="text-white">{app.name}</div>
            <div class="text-gray-400 text-sm">{app.path}</div>
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>