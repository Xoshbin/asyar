import { tick } from 'svelte';
import * as commands from '../../lib/ipc/commands';
import { viewManager } from '../../services/extension/viewManager.svelte';
import extensionManager from '../../services/extension/extensionManager.svelte';
import { extensionIframeManager } from '../../services/extension/extensionIframeManager.svelte';
import { shortcutStore } from '../../built-in-features/shortcuts/shortcutStore.svelte';
import { searchStores } from '../../services/search/stores/search.svelte';
import { contextModeService, contextActivationId } from '../../services/context/contextModeService.svelte';
import { settingsService } from '../../services/settings/settingsService.svelte';
import { isBuiltInFeature } from '../../services/extension/extensionDiscovery';
import type { ActiveContext, ContextHint } from '../../services/context/contextModeService.svelte';
import { logService } from '../../services/log/logService';
import { feedbackService } from '../../services/feedback/feedbackService.svelte';
import { commandArgumentsService } from '../../services/search/commandArguments';
import type { MappedSearchItem } from '../../services/search/types/MappedSearchItem';


export interface KeyboardDeps {
  getSearchInput: () => HTMLInputElement | null;
  getLocalSearchValue: () => string;
  setLocalSearchValue: (v: string) => void;  // must also call searchStores.query = v;
  getContextQuery: () => string;
  setContextQuery: (v: string) => void;
  getContextHint: () => ContextHint | null;
  getActiveContext: () => ActiveContext | null;
  getSearchResultsLength: () => number;
  /** The currently selected search item (if any). Needed so Tab can enter
   *  command argument mode when the selection is a command with arguments. */
  getSelectedItem?: () => MappedSearchItem | null;
  getBottomBar: () => { isOpen(): boolean; closeActionList(): void; toggleActionList(): void } | undefined;
  handleEnterKey: () => Promise<void>;
  handleContextDismiss: (clearAll?: boolean) => void;
  onBeforeHide?: () => Promise<void>; // optional: called before invoke('hide')
  isCompactIdle?: () => boolean;
  onCompactExpand?: () => void;
}

export function createKeyboardHandlers(deps: KeyboardDeps) {
  function restoreSearchFocus(opts?: { select?: boolean }) {
    const focusAndMaybeSelect = () => {
      const input = deps.getSearchInput();
      input?.focus({ preventScroll: true });
      // Raycast selects the restored query so the next keystroke replaces it.
      if (opts?.select && input && input.value.length > 0) input.select();
    };
    if (opts?.select) {
      // Restoring text: do it on the next frame so the user sees focus + selection
      // land together with the view tearing down, no visible delay.
      requestAnimationFrame(focusAndMaybeSelect);
    } else {
      // Use a slightly longer delay after goBack() to ensure the view has fully
      // unmounted and the DOM has settled before stealing focus back.
      setTimeout(focusAndMaybeSelect, 80);
    }
  }

  function isInputFocused(): boolean {
    if (extensionIframeManager.hasInputFocus) return true;
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    // Standard text-entry elements
    if (tag === 'textarea') return true;
    if (tag === 'select') return true;
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
      // These input types accept keyboard text — backspace/escape must not be stolen
      const textTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
      return textTypes.includes(type);
    }
    // contenteditable
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
  }

  // Tab on a selected command with declared arguments: enter argument mode.
  // Takes priority over context-hint commit because argument mode belongs
  // to the result list, not the search bar state. Skips when an active
  // context or view is present.
  function tryEnterArgumentMode(event: KeyboardEvent): boolean {
    if (event.key !== 'Tab') return false;
    if (commandArgumentsService.active) return false;
    if (deps.getActiveContext() || viewManager.activeView) return false;
    const item = deps.getSelectedItem?.();
    if (!item || item.type !== 'command') return false;

    const meta = extensionManager.getCommandArgMeta(item.object_id);
    if (!meta || meta.args.length === 0) return false;

    event.preventDefault();
    // Clear the context-hint chip if any is pending — argument mode
    // replaces the pending-hint affordance for this keystroke.
    contextModeService.contextHint = null;
    commandArgumentsService.enter(item.object_id).catch((err) => {
      logService.warn(`Failed to enter argument mode: ${err}`);
    });
    return true;
  }

  // Tab: commit the pending context hint into full context mode
  function tryCommitContextHint(event: KeyboardEvent): boolean {
    if (!(event.key === 'Tab' && deps.getContextHint() !== null && !deps.getActiveContext() && !viewManager.activeView)) return false;
    event.preventDefault();
    const hint = deps.getContextHint()!; // capture before any mutation
    const initialQuery = hint.type === 'ai' ? deps.getLocalSearchValue() : '';
    const providerId = hint.provider.id;
    contextModeService.contextHint = null;
    deps.setLocalSearchValue('');
    deps.setContextQuery('');
    contextModeService.activate(providerId, initialQuery);
    if (hint.provider.type === 'stream') {
      contextModeService.updateQuery('');
      deps.setContextQuery('');
    }
    tick().then(() => deps.getSearchInput()?.focus());
    return true;
  }

  // Backspace with empty context query: exit context mode (and view if open)
  function tryExitContextMode(event: KeyboardEvent): boolean {
    if (!(event.key === 'Backspace' && deps.getActiveContext() !== null && deps.getActiveContext()?.query === '')) return false;
    event.preventDefault();
    if (viewManager.activeView) {
      deps.handleContextDismiss(true);
      extensionManager.goBack();
      restoreSearchFocus();
    } else {
      deps.handleContextDismiss(false);
    }
    return true;
  }

  // Cmd/Ctrl+Q: block quit — users quit via the "Quit Asyar" command
  function tryBlockQuit(event: KeyboardEvent): boolean {
    if (!((event.key === 'q' || event.key === 'Q') && (event.metaKey || event.ctrlKey))) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  }

  // Cmd/Ctrl+,: open settings
  function tryOpenSettings(event: KeyboardEvent): boolean {
    if (!(event.key === ',' && (event.metaKey || event.ctrlKey))) return false;
    event.preventDefault();
    event.stopPropagation();
    commands.showSettingsWindow();
    return true;
  }

  // Cmd/Ctrl+K: toggle the action panel
  function tryToggleActionPanel(event: KeyboardEvent): boolean {
    if (!((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey))) return false;
    event.preventDefault();
    event.stopPropagation();
    if (deps.isCompactIdle?.()) return true; // no action panel in compact idle
    deps.getBottomBar()?.toggleActionList();
    return true;
  }

  // Escape/Backspace/Delete: close action panel before anything else.
  // For Escape we defer to the popup's own bubble-phase listener ONLY when
  // focus is inside the popup (so the popup can run its Raycast-style
  // clear-then-close chain). When focus is elsewhere (main input, body, etc.),
  // the popup's listener never fires, so we must close the panel here to
  // stop Esc from falling through to tryHandleEscape and hiding the launcher.
  function tryCloseActionPanel(event: KeyboardEvent): boolean {
    const bar = deps.getBottomBar();
    if (!bar?.isOpen()) return false;

    if (event.key === 'Escape') {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('.action-popup')) return false;
      bar.closeActionList();
      event.preventDefault();
      return true;
    }

    if (!['Backspace', 'Delete'].includes(event.key)) return false;
    // If a text input (not the main search) is focused and has content,
    // let the input handle it — don't close the panel or prevent default.
    if (isInputFocused() && document.activeElement !== deps.getSearchInput()) {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in el && (el as HTMLInputElement).value.length > 0) return false;
    }
    bar.closeActionList();
    event.preventDefault();
    return true;
  }

  // Route keyboard events to the active extension view
  function tryRouteToActiveView(event: KeyboardEvent): boolean {
    if (!viewManager.activeView) return false;
    if (deps.getBottomBar()?.isOpen()) return false;
    if (['Escape', 'Backspace', 'Delete'].includes(event.key)) {
      if (!event.defaultPrevented) {
        // Defer Backspace/Delete to actual host-DOM text inputs only, so a
        // Tier 2 iframe's stale hasInputFocus flag can't swallow the key.
        // Escape always routes to handleKeydown — tryHandleEscape there
        // decides focus-trap vs navigate based on whether a view is active.
        if (event.key !== 'Escape') {
          const active = document.activeElement;
          if (active && active !== deps.getSearchInput()) {
            const tag = active.tagName.toLowerCase();
            if (tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable) {
              return true; // Let the host-DOM input handle the keypress
            }
          }
        }
        handleKeydown(event);
      }
      return true;
    }
    const forwardKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Tab'];
    if (forwardKeys.includes(event.key)) {
      const extensionId = viewManager.activeView!.split('/')[0];
      if (!isBuiltInFeature(extensionId)) {
        extensionManager.forwardKeyToActiveView({
          key: event.key,
          shiftKey: event.shiftKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
        });
        event.preventDefault();
        event.stopPropagation();
      }
    }
    return true;
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (shortcutStore.isCapturing) {
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (feedbackService.activeDialog) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (tryBlockQuit(event)) return;
    if (tryEnterArgumentMode(event)) return;
    if (tryCommitContextHint(event)) return;
    if (tryExitContextMode(event)) return;
    if (tryOpenSettings(event)) return;
    if (tryToggleActionPanel(event)) return;
    if (tryCloseActionPanel(event)) return;
    tryRouteToActiveView(event);
  }

  // Maintain focus function
  function maintainSearchFocus(e: MouseEvent) {
     if (shortcutStore.isCapturing || feedbackService.activeDialog) return;

     const target = e.target as HTMLElement;

     // NEVER steal focus from these elements
     if (isInputFocused() && document.activeElement !== deps.getSearchInput()) return;
     
     const tag = target.tagName.toLowerCase();
     const inputTypes = ['text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week'];
     
     if (tag === 'textarea') return;
     if (tag === 'select') return;
     if (tag === 'input' && inputTypes.includes((target as HTMLInputElement).type?.toLowerCase())) return;
     if ((target as HTMLElement).isContentEditable) return;
     if (target.closest('.action-list-popup, .bottom-action-bar, [data-no-focus-steal]')) return;
     
     // For everything else, return focus to search after a tick
     requestAnimationFrame(() => {
       if (!isInputFocused() && deps.getSearchInput()) {
         deps.getSearchInput()?.focus({ preventScroll: true });
       }
     });
  }

  // Escape: focus-trap exit, navigate back, or hide window
  function tryHandleEscape(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape') return false;
    // Focus-trap only applies at root: when a view is active, Escape must
    // always navigate regardless of iframe-reported focus state (which can
    // go stale for Tier 2 extensions that auto-focus on mount and never
    // release — hotkey-entering a non-searchable view would otherwise just
    // blur the iframe forever instead of going back).
    if (!viewManager.activeView && isInputFocused() && document.activeElement !== deps.getSearchInput()) {
      (document.activeElement as HTMLElement)?.blur();
      deps.getSearchInput()?.focus({ preventScroll: true });
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    const hide = async (): Promise<void> => {
      if (deps.onBeforeHide) await deps.onBeforeHide();
      await commands.hideWindow();
    };
    const drainAndClear = () => {
      // Invariant: goBack() must strictly shrink the stack. If it ever doesn't,
      // that's a bug we want surfaced rather than silently capped.
      let prev = viewManager.getNavigationStackSize?.() ?? 0;
      while (prev > 0) {
        extensionManager.goBack();
        const next = viewManager.getNavigationStackSize?.() ?? 0;
        if (next >= prev) {
          logService.warn(`[keyboard] drainAndClear: goBack did not shrink stack (${prev} -> ${next}), aborting`);
          break;
        }
        prev = next;
      }
      deps.setLocalSearchValue('');
    };

    const escapeBehavior = settingsService.getSettings()?.general?.escapeInViewBehavior || 'go-back';

    if (viewManager.activeView) {
      if (deps.getActiveContext()) { deps.handleContextDismiss(true); }
      if (escapeBehavior === 'go-back') {
        // Raycast-style chain: clear search → pop view → (hide handled at root branch on next press)
        const lsv = deps.getLocalSearchValue();
        if (lsv.trim() !== '') {
          deps.setLocalSearchValue('');
          restoreSearchFocus();
        } else {
          extensionManager.goBack();
          restoreSearchFocus({ select: true });
        }
      } else if (escapeBehavior === 'hide-and-reset') {
        // Tear down after the window is hidden so the reset is invisible
        // to the user. Chain via the hide Promise so drainAndClear runs
        // after the Tauri hideWindow IPC resolves, not before.
        void hide().then(drainAndClear);
      } else {
        void hide();
      }
    } else {
      // At root: chain still applies for go-back (clear search before hiding).
      if (escapeBehavior === 'go-back' && deps.getLocalSearchValue().trim() !== '') {
        deps.setLocalSearchValue('');
        restoreSearchFocus();
      } else if (escapeBehavior === 'hide-and-reset') {
        void hide().then(() => deps.setLocalSearchValue(''));
      } else {
        void hide();
      }
    }
    return true;
  }

  // Backspace/Delete with empty input while a view is open: go back
  function tryHandleBackspaceInView(event: KeyboardEvent): boolean {
    if (!(viewManager.activeView && (event.key === 'Backspace' || event.key === 'Delete') && deps.getSearchInput()?.value === '')) return false;
    // Defer to actual host-DOM text inputs only — don't consult the iframe's
    // hasInputFocus flag, which can go stale for Tier 2 extensions. If the
    // iframe truly has input focus, its keydown handler runs inside the
    // iframe and the event never reaches this handler anyway.
    const active = document.activeElement;
    if (active && active !== deps.getSearchInput()) {
      const tag = active.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable) return true;
    }
    if (deps.getBottomBar()?.isOpen()) {
      deps.getBottomBar()?.closeActionList();
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    extensionManager.goBack();
    restoreSearchFocus({ select: true });
    return true;
  }

  // Arrow keys and Enter when no extension view is open
  function tryHandleSearchNavigation(event: KeyboardEvent): boolean {
    if (viewManager.activeView) return false;
    if (deps.isCompactIdle?.()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        deps.onCompactExpand?.();
      }
      // Swallow all navigation keys in compact idle
      if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
        event.preventDefault();
        return true;
      }
      return false;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const totalItems = deps.getSearchResultsLength();
      if (totalItems === 0) return true;
      
      const current = searchStores.selectedIndex;
      searchStores.selectedIndex =
        event.key === 'ArrowDown'
          ? (current + 1) % totalItems
          : (current - 1 + totalItems) % totalItems;
      
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // The input owns root-level Enter. Stop propagation so built-in features
      // that bind window keydown listeners during viewActivated (e.g. clipboard
      // history) don't receive the same Enter that triggered navigation and
      // immediately re-dispatch it as an item action.
      event.stopPropagation();
      // Context chip active: always route through the context provider.
      // The provider's onActivate is the single authority on whether a given query
      // is valid (e.g. {query} portals guard against empty submissions).
      if (deps.getActiveContext()) {
        const ctx = deps.getActiveContext()!;
        if (ctx.query.trim()) {
          contextModeService.activate(ctx.provider.id, ctx.query);
          contextModeService.updateQuery('');
        }
        // Empty query: onActivate('') will be a no-op for {query} portals,
        // and shouldn't be reached for pre-filled portals.
        return true;
      }
      deps.handleEnterKey();
      return true;
    }
    return false;
  }

  // Enter while an extension view is open: submit to view or context provider.
  // Only consume the event when actually submitting — otherwise let it bubble
  // to a built-in feature's window-level keydown listener (e.g. clipboard's
  // "Paste" action), which it registered in viewActivated and signals via
  // setActiveViewActionLabel. Calling preventDefault/stopPropagation
  // unconditionally swallowed Enter for those features.
  function tryHandleViewEnter(event: KeyboardEvent): boolean {
    if (!viewManager.activeView || event.key !== 'Enter') return false;
    if (deps.getActiveContext()) {
      const queryToSubmit = deps.getContextQuery().trim();
      if (!queryToSubmit) return false;
      event.preventDefault();
      event.stopPropagation();
      logService.debug(`Submitting context query: "${queryToSubmit}"`);
      extensionManager.handleViewSubmit(queryToSubmit);
      contextModeService.updateQuery('');
      deps.setContextQuery('');
      return true;
    }
    // The extension owns Enter when it has declared a primary action.
    if (viewManager.activeViewPrimaryActionLabel) return false;
    if (viewManager.activeViewSearchable && deps.getLocalSearchValue().trim()) {
      event.preventDefault();
      event.stopPropagation();
      logService.debug(`Submitting to active view: "${deps.getLocalSearchValue()}"`);
      extensionManager.handleViewSubmit(deps.getLocalSearchValue());
      deps.setLocalSearchValue('');
      return true;
    }
    return false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (shortcutStore.isCapturing || feedbackService.activeDialog) return;
    if (event.defaultPrevented) return;
    if (tryHandleEscape(event)) return;
    if (tryHandleBackspaceInView(event)) return;
    if (tryHandleSearchNavigation(event)) return;
    tryHandleViewEnter(event);
    // Prevent default browser scroll for arrows when search input is focused
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && document.activeElement === deps.getSearchInput()) {
      event.preventDefault();
    }
  }

  return { handleKeydown, handleGlobalKeydown, maintainSearchFocus, restoreSearchFocus, isInputFocused };
}
