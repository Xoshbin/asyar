<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = undefined,
    width = '400px',
    children,
    actions,
  }: {
    title: string;
    subtitle?: string;
    width?: string;
    children: Snippet;
    actions: Snippet;
  } = $props();
</script>

<div class="modal-overlay" role="dialog">
  <div class="modal-box" style:width={width}>
    <h3>{title}</h3>
    {#if subtitle}
      <p class="modal-subtitle">{subtitle}</p>
    {/if}
    {@render children()}
    <div class="modal-actions">
      {@render actions()}
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-box {
    background: var(--bg-popup);
    padding: 24px;
    border-radius: var(--radius-lg);
    box-shadow: 0 8px 32px var(--shadow-color), 0 0 0 1px var(--border-color);
    color: var(--text-primary);
  }

  h3 {
    margin: 0 0 16px;
    font-weight: 600;
    font-size: var(--font-size-lg);
    text-align: center;
  }

  .modal-subtitle {
    margin: -12px 0 20px;
    color: var(--text-secondary);
    font-size: var(--font-size-md);
    text-align: center;
  }

  .modal-actions {
    display: flex;
    gap: 8px;
    margin-top: 24px;
    justify-content: flex-end;
  }
</style>
