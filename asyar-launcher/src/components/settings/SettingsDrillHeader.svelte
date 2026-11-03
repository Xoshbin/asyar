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

<div class="drill-header" data-tauri-drag-region>
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
  <div class="breadcrumb" data-tauri-drag-region>
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
    padding: var(--space-4) var(--space-6);
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
    display: inline-flex;
    align-items: center;
    height: calc(var(--size-lg) + var(--space-1));
    border: 1px solid var(--border-color);
    border-radius: var(--radius-full);
    overflow: hidden;
    background: color-mix(in srgb, var(--text-primary) 4%, var(--bg-tertiary));
    box-shadow: var(--shadow-xs);
  }

  .divider {
    width: 1px;
    height: var(--size-xs);
    background: var(--border-color);
    flex-shrink: 0;
  }

  .nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--size-lg) + var(--space-1));
    height: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: default;
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

  .parent {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .parent-link {
    padding: 0;
    font-size: var(--font-size-md);
    font-weight: 500;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-family: inherit;
    cursor: default;
    transition: color var(--dur-instant) var(--ease-travel);
  }

  .parent-link:hover {
    color: var(--text-primary);
  }

  .current {
    font-size: var(--font-size-lg);
    color: var(--text-primary);
    font-weight: 600;
  }
</style>
