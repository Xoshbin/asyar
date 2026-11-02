<script lang="ts">
  import { t } from '../../services/i18n';

  let {
    title,
    parentLabel,
    canBack,
    canForward,
    onback,
    onforward,
  }: {
    title?: string;
    parentLabel: string;
    canBack: boolean;
    canForward: boolean;
    onback: () => void;
    onforward: () => void;
  } = $props();
</script>

<div class="drill-header">
  <div class="nav-group" role="group">
    <button
      class="nav-btn"
      aria-label={t('settings.nav.back')}
      disabled={!canBack}
      onclick={onback}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg
      >
    </button>
    <span class="divider"></span>
    <button
      class="nav-btn"
      aria-label={t('settings.nav.forward')}
      disabled={!canForward}
      onclick={onforward}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg
      >
    </button>
  </div>
  <div class="breadcrumb">
    <span class="parent">{parentLabel}</span>
    {#if title}
      <span class="sep">›</span>
      <span class="current">{title}</span>
    {/if}
  </div>
</div>

<style>
  .drill-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .nav-group {
    display: flex;
    align-items: center;
    border: 1px solid var(--separator);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .divider {
    width: 1px;
    align-self: stretch;
    background: var(--separator);
  }

  .nav-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1) var(--space-2);
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .nav-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .nav-btn:disabled {
    color: var(--text-secondary);
    opacity: 0.5;
    cursor: default;
  }

  .breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }

  .current {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
