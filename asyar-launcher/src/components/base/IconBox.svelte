<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    size = "md",
    rounded = "md",
    content,
  }: {
    size?: "sm" | "md" | "lg" | "xl";
    rounded?: "sm" | "md" | "lg" | "full";
    content?: Snippet;
  } = $props();

  const sizeClass = $derived(`size-${size}`);
  const roundedClass = $derived(`rounded-${rounded}`);
</script>

<div class="icon-box {sizeClass} {roundedClass}">
  {#if content}
    {@render content()}
  {/if}
</div>

<style>
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--bg-tertiary);
    color: var(--text-primary);
    flex-shrink: 0;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  /* Sizes */
  .size-sm { width: 24px; height: 24px; font-size: 14px; }
  .size-md { width: 32px; height: 32px; font-size: 18px; }
  .size-lg { width: 64px; height: 64px; font-size: 32px; }
  .size-xl { width: 128px; height: 128px; font-size: 64px; }

  /* Rounded */
  .rounded-sm { border-radius: var(--radius-xs); }
  .rounded-md { border-radius: var(--radius-sm); }
  .rounded-lg { border-radius: var(--radius-md); }
  .rounded-full { border-radius: 50%; }

  :global(.icon-box img) {
    width: 60%;
    height: 60%;
    object-fit: contain;
  }

  .size-xl :global(img) {
    width: 80%;
    height: 80%;
  }

  :global(.icon-box svg) {
    width: 1.2em;
    height: 1.2em;
  }

  .size-xl :global(svg) {
    width: 2em;
    height: 2em;
  }
</style>
