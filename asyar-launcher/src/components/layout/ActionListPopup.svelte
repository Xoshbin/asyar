<script lang="ts">
  import { logService } from '../../services/log/logService';
  import Input from '../base/Input.svelte';
  import LauncherListRow from '../list/LauncherListRow.svelte';
  import EmptyState from '../feedback/EmptyState.svelte';
  import KeyboardHint from '../base/KeyboardHint.svelte';
  import Icon from '../base/Icon.svelte';
  import { invokeAction } from '../../services/action/invokeAction';
  import {
    actionService,
    type ApplicationAction,
    type ActionPromptConfig,
  } from '../../services/action/actionService.svelte';
  import { filterActions } from './actionFilter';
  import { scrollSelectedIntoView, resetListScroll } from '../../lib/listScroll';
  import { useListSelection } from '../../lib/listSelection.svelte';
  import { groupActionsForDisplay } from './actionListOrdering';
  import { toResolvedIcon } from '../../lib/icon';
  import { t } from '../../services/i18n';
  import { tick } from 'svelte';

  type ActionForDisplay = ApplicationAction & { displayCategory: string };

  type ActionStackEntry =
    | {
        type: 'actions';
        title?: string;
        actions?: ActionForDisplay[];
      }
    | {
        type: 'prompt';
        config: ActionPromptConfig;
      };

  let {
    availableActions = [],
    selectedItemName = null,
    inExtensionView = false,
    onclose,
  }: {
    availableActions?: ActionForDisplay[];
    selectedItemName?: string | null;
    inExtensionView?: boolean;
    onclose?: () => void;
  } = $props();

  let showHeader = $derived(!inExtensionView && !!selectedItemName);

  let searchQuery = $state(actionService.panelSearchQuery);
  $effect(() => {
    actionService.panelSearchQuery = searchQuery;
  });

  let promptText = $state(actionService.activePrompt?.value ?? '');

  let viewStack = $state<ActionStackEntry[]>(
    actionService.activePrompt
      ? [{ type: 'prompt', config: actionService.activePrompt }]
      : [{ type: 'actions' }],
  );

  let currentView = $derived(viewStack[viewStack.length - 1]);

  let activeActionList = $derived(
    currentView?.type === 'actions' && currentView.actions ? currentView.actions : availableActions,
  );

  let filteredForSearch = $derived(filterActions(activeActionList, searchQuery));
  let groupedActions = $derived(groupActionsForDisplay(filteredForSearch));
  let flatActions = $derived(groupedActions.flatMap((g) => g.actions));

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

  const selection = useListSelection({ items: () => flatActions });

  function scrollSelected() {
    requestAnimationFrame(() => {
      if (popupRef) scrollSelectedIntoView(popupRef, selection.selectedIndex);
    });
  }

  $effect(() => {
    const _query = searchQuery;
    const _actions = flatActions;
    const idx = selection.selectedIndex;
    if (popupRef && idx >= 0) {
      requestAnimationFrame(() => {
        if (popupRef) scrollSelectedIntoView(popupRef, idx);
      });
    } else if (popupRef && idx < 0) {
      requestAnimationFrame(() => {
        if (popupRef) resetListScroll(popupRef);
      });
    }
  });

  // Watch for prompts opened via actionService.openPrompt(...)
  $effect(() => {
    const prompt = actionService.activePrompt;
    if (prompt) {
      const isAlreadyOnTop =
        viewStack.length > 0 &&
        viewStack[viewStack.length - 1].type === 'prompt' &&
        (viewStack[viewStack.length - 1] as any).config === prompt;
      if (!isAlreadyOnTop) {
        promptText = prompt.value ?? '';
        viewStack = [...viewStack, { type: 'prompt', config: prompt }];
        void tick().then(() => {
          const input = popupRef?.querySelector('.prompt-body input') as HTMLInputElement | null;
          input?.focus({ preventScroll: true });
          input?.select();
        });
      }
    }
  });

  function handleKeydown(event: KeyboardEvent) {
    if (currentView?.type === 'prompt') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (promptText.length > 0) {
          promptText = '';
        } else {
          const config = currentView.config;
          config.oncancel?.();
          actionService.activePrompt = null;
          viewStack = viewStack.slice(0, -1);
          if (viewStack.length === 0) {
            closePopup();
          } else {
            void tick().then(() => {
              popupRef
                ?.querySelector<HTMLInputElement>('.action-search input')
                ?.focus({ preventScroll: true });
            });
          }
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        const config = currentView.config;
        const valToSave = promptText;
        actionService.activePrompt = null;
        closePopup();
        void config.onsave(valToSave);
        return;
      }

      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      // Esc clears the filter first, then closes or pops stack
      if (searchQuery.length > 0) {
        searchQuery = '';
        actionService.panelSearchQuery = '';
      } else if (viewStack.length > 1) {
        viewStack = viewStack.slice(0, -1);
        searchQuery = '';
        void tick().then(() => {
          popupRef
            ?.querySelector<HTMLInputElement>('.action-search input')
            ?.focus({ preventScroll: true });
        });
      } else {
        actionService.panelSearchQuery = '';
        closePopup();
      }
      return;
    }

    if (flatActions.length === 0) return;

    const isDown = event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey);
    const isUp = event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey);

    if (isDown || isUp) {
      event.preventDefault();
      event.stopPropagation();
      selection.moveSelection(isDown ? 'down' : 'up');
      scrollSelected();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const action = selection.selectedItem;
      if (action) handleActionSelect(action.id);
    }
  }

  async function handleActionSelect(actionId: string) {
    logService.debug(`[ActionListPopup] Action selected: ${actionId}`);
    const action = flatActions.find((a) => a.id === actionId);
    if (!action) return;

    if ((action as any).children?.length) {
      viewStack = [
        ...viewStack,
        {
          type: 'actions',
          title: action.label,
          actions: (action as any).children,
        },
      ];
      searchQuery = '';
      return;
    }

    if (action.confirm && !action.confirmInExecute) {
      closePopup();
    }

    await invokeAction(action);

    if (!actionService.activePrompt) {
      closePopup();
    }
  }

  function closePopup() {
    logService.debug('[ActionListPopup] Closing popup');
    onclose?.();
  }

  function onWindowMousedown(e: MouseEvent) {
    const target = e.target as Node | null;
    if (target && !popupRef?.contains(target)) {
      if (currentView?.type === 'prompt') {
        currentView.config.oncancel?.();
        actionService.activePrompt = null;
      }
      closePopup();
    }
  }

  $effect(() => {
    window.addEventListener('mousedown', onWindowMousedown);
    return () => window.removeEventListener('mousedown', onWindowMousedown);
  });

  $effect(() => {
    const timer = setTimeout(() => {
      if (currentView?.type === 'prompt') {
        const input = popupRef?.querySelector('.prompt-body input') as HTMLInputElement | null;
        input?.focus({ preventScroll: true });
        input?.select();
      } else {
        popupRef
          ?.querySelector<HTMLInputElement>('.action-search input')
          ?.focus({ preventScroll: true });
      }
    }, 50);
    popupRef?.addEventListener('keydown', handleKeydown);
    return () => {
      clearTimeout(timer);
      popupRef?.removeEventListener('keydown', handleKeydown);
      if (!actionService.activePrompt) {
        actionService.panelSearchQuery = '';
      }
    };
  });
</script>

<div
  bind:this={popupRef}
  class="action-popup launcher-popup"
  class:entering
  tabindex="-1"
  role="dialog"
  aria-modal="true"
  aria-labelledby={currentView?.type === 'prompt' ? 'action-prompt-heading' : 'action-list-heading'}
>
  {#if currentView?.type === 'prompt'}
    {@const config = currentView.config}
    <div class="prompt-header">
      <h2 id="action-prompt-heading" class="prompt-title">{config.title}</h2>
    </div>

    <div class="prompt-body">
      <Input
        textIntent="exact"
        bind:value={promptText}
        placeholder={config.placeholder}
        autocomplete="off"
      />
    </div>

    <div class="prompt-footer">
      <div class="footer-context">
        {#if config.icon}
          <div class="footer-icon-box">
            <Icon name={config.icon} size={11} />
          </div>
        {/if}
        {#if config.contextLabel}
          <span class="context-text">{config.contextLabel}</span>
        {/if}
      </div>
      <div class="footer-actions">
        <KeyboardHint
          keys="Esc"
          action={promptText.length > 0
            ? t('common.clear')
            : (config.cancelLabel ?? t('common.cancel'))}
        />
        <KeyboardHint keys="↵" action={config.saveLabel ?? t('common.save')} />
      </div>
    </div>
  {:else}
    <h2 id="action-list-heading" class="sr-only">{t('actions_popup.sr_heading')}</h2>

    <div class="action-scroll custom-scrollbar">
      {#if showHeader}
        <div class="popup-header">{selectedItemName}</div>
      {/if}
      {#snippet iconSpacer()}<span class="icon-spacer" aria-hidden="true"></span>{/snippet}
      {#each groupedActions as { actions: groupActions }, groupIndex}
        {@const groupHasIcons = groupActions.some((a) => toResolvedIcon(a.icon))}
        <div class="group-section" class:first-group={groupIndex === 0}>
          {#each groupActions as action}
            {@const flatIndex = flatActions.indexOf(action)}
            <div class="action-row" class:action-destructive={action.destructive}>
              <LauncherListRow
                selected={flatIndex === selection.selectedIndex}
                onclick={() => handleActionSelect(action.id)}
                data-index={flatIndex}
                tabindex="-1"
                icon={action.icon}
                extensionId={action.extensionId}
                leading={groupHasIcons && !toResolvedIcon(action.icon) ? iconSpacer : undefined}
                title={action.label}
                shortcut={action.shortcut}
                shortcutPlacement="trailing"
              />
            </div>
          {/each}
        </div>
      {:else}
        <EmptyState message={t('dialogs.action_list.no_matching_actions')} />
      {/each}
    </div>

    <div class="action-search launcher-popup-search">
      <Input
        textIntent="exact"
        bind:value={searchQuery}
        placeholder={t('dialogs.action_list.search_placeholder')}
        autocomplete="off"
      />
    </div>
  {/if}
</div>

<style>
  /* Surface (fill, blur, border, radius, shadow) comes from .launcher-popup
     in style.css, shared with the dropdown argument list. */
  .action-popup {
    position: fixed;
    bottom: calc(var(--shell-footer-h) + var(--space-3));
    right: 12px;
    width: 350px;
    /* ~6 rows + search bar; keeps the popup from hiding the launcher bottom. */
    max-height: 243px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    z-index: var(--z-dropdown);
    outline: none;
    /* The panel belongs to the ⌘K button, so it grows from that corner.
       Reduced motion is handled globally in style.css. */
    transform-origin: bottom right;
    opacity: 1;
    transform: scale(1);
    transition:
      opacity var(--dur-quick) var(--ease-emerge),
      transform var(--dur-quick) var(--ease-emerge);
  }

  .action-popup.entering {
    opacity: 0;
    transform: scale(0.96);
  }

  .popup-header {
    padding: var(--space-4);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
    user-select: none;
  }

  .action-scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    /* Top inset is margin so the macOS overlay scrollbar track starts below
       the rounded top corner. */
    margin-top: var(--space-3);
    padding: 0 var(--space-3) var(--space-3);
  }

  .group-section {
    margin-bottom: var(--space-1);
  }

  /* Negative side margins cancel .action-scroll's padding so the divider
     runs edge-to-edge while the rows stay inset. */
  .group-section:not(.first-group)::before {
    content: '';
    display: block;
    height: 1px;
    background-color: var(--popup-divider);
    margin: var(--space-4) calc(-1 * var(--space-3));
  }

  /* Everything else about the row is .launcher-popup-search in style.css. */
  .action-search {
    border-top: 1px solid var(--popup-divider);
  }

  /* Keeps titles aligned when only some actions in a section have an icon. */
  .icon-spacer {
    width: 22px; /* design-ok: the LauncherListRow icon box */
    flex-shrink: 0;
  }

  .action-row :global(.result-title) {
    font-size: var(--font-size-md);
  }

  /* Flat, larger glyph in the popup — no filled tile. Glyphs with their own
     tile colour keep it. */
  .action-popup :global(.app-icon-tile:not(.app-icon-colored)) {
    background-color: transparent;
    color: var(--text-primary);
  }
  .action-popup :global(.app-icon-tile:not(.app-icon-colored) svg) {
    width: 18px; /* design-ok: matches the popup's former 18px glyph */
    height: 18px; /* design-ok: matches the popup's former 18px glyph */
  }

  .action-destructive :global(.result-title),
  .action-destructive :global(.app-icon-tile) {
    color: var(--accent-danger) !important;
  }

  .prompt-header {
    padding: var(--space-3) var(--space-4) var(--space-2);
  }

  .prompt-title {
    font-size: var(--font-size-sm);
    font-weight: 500;
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
    min-height: 32px;
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
    font-weight: 500;
  }

  .footer-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
</style>
