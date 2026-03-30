<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    description = '',
    children,
  }: {
    title: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<section class="settings-section">
  <div class="settings-section-header">
    <h2 class="settings-section-title">{title}</h2>
    {#if description}
      <p class="settings-section-description">{description}</p>
    {/if}
  </div>
  <div class="settings-section-content">
    {@render children()}
  </div>
</section>

<style>
  .settings-section {
    border: 1px solid var(--separator);
    border-radius: var(--radius-lg);
    background-color: var(--bg-secondary);
    box-shadow: var(--shadow-xs);
    overflow: hidden;
  }

  .settings-section-header {
    padding: var(--space-6);
    border-bottom: 1px solid var(--separator);
  }

  .settings-section-title {
    font-size: var(--font-size-base);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .settings-section-description {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    margin: var(--space-2) 0 0;
  }

  .settings-section-content {
    padding: 0 var(--space-6);
  }
</style>
