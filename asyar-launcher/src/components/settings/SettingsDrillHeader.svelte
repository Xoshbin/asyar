<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from '../base/Icon.svelte';
  import { t } from '../../services/i18n';

  let {
    title,
    parentLabel,
    canBack,
    canForward,
    onback,
    onforward,
    actions,
  }: {
    title?: string;
    parentLabel: string;
    canBack: boolean;
    canForward: boolean;
    onback: () => void;
    onforward: () => void;
    /** Trailing controls (e.g. the enable toggle) on the right of the bar. */
    actions?: Snippet;
  } = $props();

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  }

  // ⌘[ / ⌘] are the browser-style history chords; Alt+←/→ is the same pair
  // for keyboards without ⌘. Alt+arrow moves the caret by word in a text
  // field, so it is left alone there (⌘[ / ⌘] are not text-editing keys).
  function onWindowKeydown(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    const alt = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey;
    const back = (meta && e.key === '[') || (alt && e.key === 'ArrowLeft');
    const forward = (meta && e.key === ']') || (alt && e.key === 'ArrowRight');
    if (!back && !forward) return;
    if (alt && isEditable(e.target)) return;
    if (back && canBack) {
      e.preventDefault();
      onback();
    } else if (forward && canForward) {
      e.preventDefault();
      onforward();
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="drill-header">
  <div class="nav-group" role="group">
    <button
      class="nav-btn"
      aria-label={t('settings.nav.back')}
      disabled={!canBack}
      onclick={onback}
    >
      <Icon name="chevron-left" size={14} />
    </button>
    <span class="divider"></span>
    <button
      class="nav-btn"
      aria-label={t('settings.nav.forward')}
      disabled={!canForward}
      onclick={onforward}
    >
      <Icon name="chevron-right" size={14} />
    </button>
  </div>
  <div class="breadcrumb">
    {#if title}
      <button class="parent-link" onclick={onback}>{parentLabel}</button>
      <span class="sep">›</span>
      <span class="current">{title}</span>
    {:else}
      <span class="parent">{parentLabel}</span>
    {/if}
  </div>
  {#if actions}
    <div class="actions">{@render actions()}</div>
  {/if}
</div>

<style>
  .drill-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-6);
    border-bottom: 1px solid var(--separator);
    background: var(--bg-primary);
    flex-shrink: 0;
    /* Pinned over the padded, scrolling content area it lives in. */
    position: sticky;
    top: calc(-1 * var(--space-5));
    z-index: var(--z-raised);
    margin: calc(-1 * var(--space-5)) calc(-1 * var(--space-6)) 0;
  }

  .breadcrumb {
    flex: 1;
    min-width: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-shrink: 0;
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

  .parent-link {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    cursor: pointer;
    transition: color var(--dur-instant) var(--ease-travel);
  }

  .parent-link:hover {
    color: var(--text-primary);
  }

  .current {
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
