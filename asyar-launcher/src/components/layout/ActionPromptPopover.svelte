<script lang="ts">
  import Input from '../base/Input.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import Icon from '../base/Icon.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { t } from '../../services/i18n';

  let {
    title,
    value = '',
    placeholder = '',
    icon = undefined,
    contextLabel = undefined,
    saveLabel = undefined,
    cancelLabel = undefined,
    onsave,
    oncancel,
  }: {
    title: string;
    value?: string;
    placeholder?: string;
    icon?: string;
    contextLabel?: string;
    saveLabel?: string;
    cancelLabel?: string;
    onsave: (val: string) => void | Promise<void>;
    oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let textValue = $state(value);
  $effect(() => {
    textValue = value;
  });
  let popupRef = $state<HTMLDivElement>();
  let entering = $state(true);

  $effect(() => {
    let settleFrame: number | undefined;
    const paintFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => (entering = false));
    });

    return () => {
      cancelAnimationFrame(paintFrame);
      if (settleFrame !== undefined) cancelAnimationFrame(settleFrame);
    };
  });

  // Focus the input on open, and restore prior focus on unmount
  $effect(() => {
    const prevActive =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const timer = setTimeout(() => {
      const input = popupRef?.querySelector('input');
      input?.focus({ preventScroll: true });
      input?.select();
    }, 50);

    return () => {
      clearTimeout(timer);
      if (prevActive && document.contains(prevActive)) {
        prevActive.focus({ preventScroll: true });
      }
    };
  });

  // Register escape interceptor so window capture or global handlers do not navigate back
  $effect(() => {
    const unregister = viewManager.registerEscapeInterceptor(() => {
      if (textValue.length > 0) {
        textValue = '';
      } else {
        oncancel();
      }
      return true;
    });
    return unregister;
  });

  // Dismiss on outside click (matching SearchBarAccessoryDropdown and ActionListPopup)
  function onWindowMousedown(e: MouseEvent) {
    const target = e.target as Node | null;
    if (target && !popupRef?.contains(target)) {
      oncancel();
    }
  }

  $effect(() => {
    window.addEventListener('mousedown', onWindowMousedown);
    return () => window.removeEventListener('mousedown', onWindowMousedown);
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (textValue.length > 0) {
        textValue = '';
      } else {
        oncancel();
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      onsave(textValue);
    }
  }
</script>

<div
  bind:this={popupRef}
  class="action-prompt-popover launcher-popup"
  class:entering
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby="action-prompt-heading"
  onkeydown={handleKeydown}
>
  <div class="prompt-header">
    <h2 id="action-prompt-heading" class="prompt-title">{title}</h2>
  </div>

  <div class="prompt-body">
    <Input textIntent="exact" bind:value={textValue} {placeholder} autocomplete="off" />
  </div>

  <div class="prompt-footer">
    <div class="footer-context">
      {#if icon}
        <div class="footer-icon-box">
          <Icon name={icon} size={11} />
        </div>
      {/if}
      {#if contextLabel}
        <span class="context-text">{contextLabel}</span>
      {/if}
    </div>
    <div class="footer-actions">
      <KeyboardHint
        keys="Esc"
        action={textValue.length > 0 ? t('common.clear') : (cancelLabel ?? t('common.cancel'))}
      />
      <KeyboardHint keys="↵" action={saveLabel ?? t('common.save')} />
    </div>
  </div>
</div>

<style>
  .action-prompt-popover {
    position: fixed;
    bottom: calc(var(--shell-footer-h) + var(--space-3));
    right: 12px;
    width: 350px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: var(--z-dropdown);
    outline: none;
    transform-origin: bottom right;
    opacity: 1;
    transform: scale(1);
    transition:
      opacity var(--dur-quick) var(--ease-emerge),
      transform var(--dur-quick) var(--ease-emerge);
  }

  .action-prompt-popover.entering {
    opacity: 0;
    transform: scale(0.96);
  }

  .prompt-header {
    padding: var(--space-3) var(--space-4) var(--space-2);
  }

  .prompt-title {
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-medium);
    color: var(--text-primary);
    margin: 0;
    user-select: none;
  }

  .prompt-body {
    padding: 0 var(--space-4) var(--space-3);
  }

  .prompt-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    min-height: var(--size-xl);
    background: transparent;
    border-top: 1px solid var(--popup-divider);
    user-select: none;
  }

  .footer-context {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .footer-icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm);
    background: var(--tile-orange);
    color: var(--text-on-accent);
    flex-shrink: 0;
  }

  .context-text {
    font-weight: var(--font-weight-medium);
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
</style>
