<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    icon,
    message = "No items found",
    description,
    children,
  }: {
    icon?: Snippet;
    message?: string;
    description?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="empty-state">
  {#if icon}
    <div class="empty-state-icon">
      {@render icon()}
    </div>
  {/if}
  <div class="empty-state-message text-title">{message}</div>
  {#if description}
    <div class="empty-state-description text-caption">{description}</div>
  {/if}
  {#if children}
    <div class="empty-state-actions">
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .empty-state-icon {
    margin-bottom: 8px;
    font-size: 32px;
    opacity: 0.6;
    color: var(--text-tertiary);
  }

  .empty-state-message {
    color: var(--text-primary);
  }

  .empty-state-description {
    max-width: 240px;
    color: var(--text-secondary);
  }
</style>
