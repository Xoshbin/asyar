<script lang="ts">
  import { crashPromptState } from '../../services/feedback/crashPromptState.svelte';
  import Button from '../base/Button.svelte';
  import Input from '../base/Input.svelte';
  import { t } from '../../services/i18n';

  let showDetails = $state(false);
</script>

{#if crashPromptState.visible && crashPromptState.payload}
  <div class="crash-prompt" role="region" aria-label={t('dialogs.crash_report.title')}>
    <div class="crash-prompt-header">
      <span class="crash-prompt-title">{t('dialogs.crash_report.title')}</span>
      <span class="crash-prompt-subtitle">
        {t('dialogs.crash_report.subtitle')}
      </span>
    </div>

    <div class="crash-prompt-email">
      <Input
        textIntent="exact"
        bind:value={crashPromptState.email}
        type="email"
        placeholder={t('dialogs.crash_report.email_placeholder')}
        disabled={crashPromptState.isSending}
      />
    </div>

    <button
      class="crash-prompt-details-toggle"
      type="button"
      onclick={() => {
        showDetails = !showDetails;
      }}
      aria-expanded={showDetails}
    >
      {showDetails
        ? t('dialogs.crash_report.details_hide')
        : t('dialogs.crash_report.details_view')}
    </button>

    {#if showDetails}
      <pre class="text-mono custom-scrollbar crash-prompt-pre">{JSON.stringify(
          crashPromptState.payload,
          null,
          2,
        )}</pre>
    {/if}

    {#if crashPromptState.sendError}
      <p class="crash-prompt-error">{crashPromptState.sendError}</p>
    {/if}

    <div class="crash-prompt-actions">
      <Button
        onclick={() => crashPromptState.send()}
        disabled={crashPromptState.isSending}
        class="btn-primary"
      >
        {crashPromptState.isSending
          ? t('dialogs.crash_report.sending')
          : t('dialogs.crash_report.send')}
      </Button>
      <Button
        onclick={() => crashPromptState.dismiss()}
        disabled={crashPromptState.isSending}
        class="btn-secondary"
      >
        {t('dialogs.crash_report.dismiss')}
      </Button>
    </div>
  </div>
{/if}

<style>
  .crash-prompt {
    position: fixed;
    bottom: calc(var(--space-10) + var(--space-3));
    left: var(--space-5);
    right: var(--space-5);
    z-index: var(--z-overlay);
    background: color-mix(in srgb, var(--bg-popup) 97%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-warning) 60%, transparent);
    border-radius: var(--radius-md);
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    box-shadow: var(--shadow-xl);
  }

  .crash-prompt-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .crash-prompt-title {
    font-size: var(--font-size-md);
    font-family: var(--font-ui);
    color: var(--text-primary);
    font-weight: 600;
  }

  .crash-prompt-subtitle {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
  }

  .crash-prompt-email {
    width: 100%;
  }

  .crash-prompt-details-toggle {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--text-secondary);
    text-align: left;
    text-decoration: underline;
  }

  .crash-prompt-details-toggle:hover {
    color: var(--text-primary);
  }

  .crash-prompt-details-toggle:focus-visible {
    box-shadow: var(--shadow-focus);
    outline: none;
  }

  .crash-prompt-pre {
    max-height: calc(var(--space-11) * 3);
    overflow-y: auto;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    padding: var(--space-3);
    margin: 0;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .crash-prompt-error {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--accent-danger);
    margin: 0;
  }

  .crash-prompt-actions {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
</style>
