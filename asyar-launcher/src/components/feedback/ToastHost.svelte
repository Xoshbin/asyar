<script lang="ts">
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { fadeIn } from '$lib/transitions';
</script>

{#if feedbackService.activeToast}
  {@const toast = feedbackService.activeToast}
  <div
    class="toast-host"
    role="status"
    aria-live="polite"
    transition:fadeIn={{ duration: 150 }}
    data-style={toast.style}
  >
    <span class="toast-icon" aria-hidden="true">
      {#if toast.style === 'animated'}
        <span class="spinner"></span>
      {:else if toast.style === 'success'}
        <span class="symbol">✓</span>
      {:else if toast.style === 'failure'}
        <span class="symbol">✕</span>
      {/if}
    </span>
    <div class="toast-text">
      <span class="toast-title">{toast.title}</span>
      {#if toast.message}
        <span class="toast-message">{toast.message}</span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .toast-host {
    position: fixed;
    bottom: 56px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(560px, calc(100vw - 32px));
    padding: 8px 14px;
    background: color-mix(in srgb, var(--bg-popup) 92%, transparent);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-popup);
    z-index: 60;
    pointer-events: none;
  }

  :global(html[data-platform='linux']) .toast-host {
    backdrop-filter: none;
    background-color: var(--bg-popup);
  }

  .toast-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toast-host[data-style='animated'] .toast-icon {
    color: var(--text-secondary);
  }
  .toast-host[data-style='success'] .toast-icon {
    color: var(--accent-success);
  }
  .toast-host[data-style='failure'] .toast-icon {
    color: var(--accent-danger);
  }

  .toast-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .toast-title {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toast-host[data-style='success'] .toast-title {
    color: var(--accent-success);
  }
  .toast-host[data-style='failure'] .toast-title {
    color: var(--accent-danger);
  }

  .toast-message {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .symbol {
    font-size: 13px;
    font-weight: 700;
    line-height: 1;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 1.5px solid currentColor;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
