<script lang="ts">
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { fadeIn } from '$lib/transitions';
  import { IconButton } from '../index';
</script>

{#snippet announcementBody(announcement: NonNullable<typeof feedbackService.activeAnnouncement>)}
  <span class="toast-icon" aria-hidden="true">
    <span class="symbol">✦</span>
  </span>
  <div class="toast-text">
    <span class="toast-title">{announcement.title}</span>
    {#if announcement.message}
      <span class="toast-message">{announcement.message}</span>
    {/if}
  </div>
{/snippet}

{#if feedbackService.activeAnnouncement}
  {@const announcement = feedbackService.activeAnnouncement}
  <div
    class="toast-host"
    class:toast-clickable={Boolean(announcement.onClick)}
    transition:fadeIn={{ duration: 150 }}
    role="status"
    aria-live="polite"
  >
    {#if announcement.onClick}
      <button class="toast-action" onclick={() => feedbackService.onAnnouncementClicked()}>
        {@render announcementBody(announcement)}
      </button>
    {:else}
      {@render announcementBody(announcement)}
    {/if}
    <IconButton
      class="toast-dismiss"
      ariaLabel="Dismiss announcement"
      title="Dismiss announcement"
      size="sm"
      onclick={() => feedbackService.onAnnouncementDismissed()}
    >
      ×
    </IconButton>
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
    pointer-events: auto;
  }

  :global(html[data-platform='linux']) .toast-host {
    backdrop-filter: none;
    background-color: var(--bg-popup);
  }

  .toast-clickable:hover {
    border-color: var(--accent-primary);
  }

  .toast-action {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .toast-icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .toast-icon {
    color: var(--accent-primary);
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
</style>
