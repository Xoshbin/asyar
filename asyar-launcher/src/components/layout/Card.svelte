<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title = "",
    children
  }: {
    title?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="p-6 rounded-[var(--radius-lg)] mb-6 border border-[var(--border-color)] flex-shrink-0" style="background-color: var(--bg-secondary);">
  {#if title}
    <h2 class="text-xl font-semibold mb-4 text-[var(--text-primary)]">{title}</h2>
  {/if}
  {@render children?.()}
</div>