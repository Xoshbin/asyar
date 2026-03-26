<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    leftWidth = "33.333%",
    minLeftWidth = 200,
    maxLeftWidth = 800,
    left,
    right
  }: {
    leftWidth?: string | number;
    minLeftWidth?: number;
    maxLeftWidth?: number;
    left?: Snippet;
    right?: Snippet;
  } = $props();

  let isResizing = $state(false);
  let startX = $state(0);
  let startWidth = $state(0);
  let leftPanel = $state<HTMLDivElement>();
  let rightPanel = $state<HTMLDivElement>();

  function startResize(event: MouseEvent) {
    isResizing = true;
    startX = event.pageX;
    startWidth = leftPanel?.offsetWidth ?? 0;
    window.addEventListener('mousemove', handleResize);
    window.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing || !leftPanel) return;
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
      {@render left?.()}
    </div>

    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
      class="w-1 hover:w-2 cursor-ew-resize hover:bg-[var(--border-color)] transition-all z-10"
      role="separator"
      aria-orientation="vertical"
      onmousedown={startResize}
    ></div>

    <div bind:this={rightPanel} class="split-view-right h-full">
      {@render right?.()}
    </div>
  </div>
</div>

<style>
  .split-view-content {
    isolation: isolate;
    contain: strict;
  }
</style>
