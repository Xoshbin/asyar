<script lang="ts">
  export let leftWidth: string | number = "33.333%";  // Using percentage instead of fraction
  export let minLeftWidth = 200;
  export let maxLeftWidth = 800;
  import { onMount, tick } from 'svelte';

  let isResizing = false;
  let startX: number;
  let startWidth: number;
  let leftPanel: HTMLDivElement;
  let rightPanel: HTMLDivElement;


  function startResize(event: MouseEvent) {
    isResizing = true;
    startX = event.pageX;
    startWidth = leftPanel.offsetWidth;
    
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing) return;
    
    const diff = event.pageX - startX;
    const newWidth = Math.min(Math.max(startWidth + diff, minLeftWidth), maxLeftWidth);
    leftPanel.style.width = `${newWidth}px`;
  }

  function stopResize() {
    isResizing = false;
    window.removeEventListener('mousemove', handleResize);
    window.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
</script>

<div class="split-view">
  <div class="split-view-content isolate">
    <div 
      bind:this={leftPanel}
      class="split-view-left custom-scrollbar h-full overflow-y-auto"
      style="width: {typeof leftWidth === 'number' ? `${leftWidth}px` : leftWidth}"
    >
      <slot name="left" />
    </div>

    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10"
      role="separator"
      aria-orientation="vertical"
      on:mousedown={startResize}
    ></div>

    <div bind:this={rightPanel} class="split-view-right h-full">
      <slot name="right" />
    </div>
  </div>
</div>

<style>
  .split-view-content {
    isolation: isolate;
    contain: strict;
  }
</style>
