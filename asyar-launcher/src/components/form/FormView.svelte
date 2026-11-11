<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { actionService } from '../../services/action/actionService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import type { IconSource } from '../../lib/icon';

  let {
    actionId,
    submitLabel,
    submitIcon = 'icon:check',
    extensionId,
    category,
    submitDisabled = false,
    autofocus = true,
    restoreSearchFocusOnCancel = false,
    onsubmit,
    oncancel,
    header,
    children,
  }: {
    actionId: string;
    submitLabel: string;
    submitIcon?: IconSource;
    extensionId?: string;
    category?: string;
    submitDisabled?: boolean;
    autofocus?: boolean;
    restoreSearchFocusOnCancel?: boolean;
    onsubmit: () => void | Promise<void>;
    oncancel?: () => void;
    header?: Snippet;
    children: Snippet;
  } = $props();

  let bodyRef = $state<HTMLDivElement | null>(null);

  function restoreSearchFocus() {
    if (!restoreSearchFocusOnCancel) return;
    let retries = 0;
    const focusWhenReady = () => {
      const searchInput = document.querySelector<HTMLInputElement>('input.search-input-clean');
      if (!searchInput) return;
      if (searchInput.disabled && retries < 4) {
        retries += 1;
        requestAnimationFrame(focusWhenReady);
        return;
      }
      if (searchInput.disabled || document.activeElement === searchInput) return;
      searchInput.focus({ preventScroll: true });
    };
    requestAnimationFrame(focusWhenReady);
  }

  $effect(() => {
    actionService.registerAction({
      id: actionId,
      label: submitLabel,
      icon: submitIcon,
      shortcut: 'Mod+Enter',
      primary: true,
      disabled: submitDisabled,
      extensionId,
      category,
      context: ActionContext.EXTENSION_VIEW,
      execute: () => onsubmit(),
    });
    return () => {
      actionService.unregisterAction(actionId);
    };
  });

  $effect(() => {
    if (!oncancel) return;
    const unregister = viewManager.registerEscapeInterceptor(() => {
      oncancel();
      restoreSearchFocus();
      return true;
    });
    return unregister;
  });

  onMount(async () => {
    if (!autofocus) return;
    await tick();
    requestAnimationFrame(() => {
      if (!bodyRef) return;
      const active = document.activeElement;
      if (active && bodyRef.contains(active)) return;
      const explicit = bodyRef.querySelector<HTMLElement>(
        '[data-autofocus]:not(:disabled), [autofocus]:not(:disabled)',
      );
      const first =
        explicit ??
        bodyRef.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not(:disabled):not([readonly]), textarea:not(:disabled), [data-select-trigger]:not(:disabled), [role="switch"]:not(:disabled)',
        );
      first?.focus({ preventScroll: true });
    });
  });
</script>

<div class="form-view" data-no-focus-steal>
  <div bind:this={bodyRef} class="form-view-body custom-scrollbar">
    {#if header}
      <div class="form-view-header">
        {@render header()}
      </div>
    {/if}
    {@render children()}
  </div>
</div>

<style>
  .form-view {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }

  .form-view-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior-y: contain;
    padding: var(--space-5);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .form-view-header {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
