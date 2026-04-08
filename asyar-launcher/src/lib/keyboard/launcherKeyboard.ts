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


export interface KeyboardDeps {
  getSearchInput: () => HTMLInputElement | null;
  getLocalSearchValue: () => string;
  setLocalSearchValue: (v: string) => void;  // must also call searchStores.query = v;
  getContextQuery: () => string;
  setContextQuery: (v: string) => void;
  getContextHint: () => ContextHint | null;
  getActiveContext: () => ActiveContext | null;
  getSearchResultsLength: () => number;
  getBottomBar: () => { isOpen(): boolean; closeActionList(): void; toggleActionList(): void } | undefined;
  handleEnterKey: () => Promise<void>;
  handleContextDismiss: (clearAll?: boolean) => void;
  onBeforeHide?: () => Promise<void>; // optional: called before invoke('hide')
}

export function createKeyboardHandlers(deps: KeyboardDeps) {
  function restoreSearchFocus() {
    // Use a slightly longer delay after goBack() to ensure the view has fully
    // unmounted and the DOM has settled before stealing focus back.
    setTimeout(() => {
      deps.getSearchInput()?.focus({ preventScroll: true });
    }, 80);
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
    deps.getBottomBar()?.toggleActionList();
    return true;
  }

  // Escape/Backspace/Delete: close action panel before anything else
  function tryCloseActionPanel(event: KeyboardEvent): boolean {
    if (!(['Escape', 'Backspace', 'Delete'].includes(event.key) && deps.getBottomBar()?.isOpen())) return false;
    // For Backspace/Delete: if a text input (not the main search) is focused and has content,
    // let the input handle it — don't close the panel or prevent default.
    if (event.key !== 'Escape' && isInputFocused() && document.activeElement !== deps.getSearchInput()) {
      const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
      if ('value' in el && (el as HTMLInputElement).value.length > 0) return false;
    }
    deps.getBottomBar()?.closeActionList();
    event.preventDefault();
    return true;
  }

  // Route keyboard events to the active extension view
  function tryRouteToActiveView(event: KeyboardEvent): boolean {
    if (!viewManager.activeView) return false;
    if (deps.getBottomBar()?.isOpen()) return false;
    if (['Escape', 'Backspace', 'Delete'].includes(event.key)) {
      if (!event.defaultPrevented) {
        if (isInputFocused() && document.activeElement !== deps.getSearchInput()) {
          if (event.key === 'Escape') {
            (document.activeElement as HTMLElement)?.blur();
            deps.getSearchInput()?.focus({ preventScroll: true });
            event.preventDefault();
          }
          return true; // Do NOT navigate for Backspace/Delete in an input
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
    if (tryCommitContextHint(event)) return;
    if (tryExitContextMode(event)) return;
    if (tryOpenSettings(event)) return;
    if (tryToggleActionPanel(event)) return;
    if (tryCloseActionPanel(event)) return;
    tryRouteToActiveView(event);
  }

  // Maintain focus function
  function maintainSearchFocus(e: MouseEvent) {
     if (shortcutStore.isCapturing) return;

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
    if (isInputFocused() && document.activeElement !== deps.getSearchInput()) {
      (document.activeElement as HTMLElement)?.blur();
      deps.getSearchInput()?.focus({ preventScroll: true });
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    if (viewManager.activeView) {
      if (deps.getActiveContext()) { deps.handleContextDismiss(true); }
      const escapeBehavior = settingsService.getSettings()?.general?.escapeInViewBehavior || 'close-window';
      if (escapeBehavior === 'go-back') {
        extensionManager.goBack();
        restoreSearchFocus();
      } else {
        if (deps.onBeforeHide) {
          deps.onBeforeHide().then(() => commands.hideWindow());
        } else {
          commands.hideWindow();
        }
      }
    } else {
      if (deps.onBeforeHide) {
        deps.onBeforeHide().then(() => commands.hideWindow());
      } else {
        commands.hideWindow();
      }
    }
    return true;
  }

  // Backspace/Delete with empty input while a view is open: go back
  function tryHandleBackspaceInView(event: KeyboardEvent): boolean {
    if (!(viewManager.activeView && (event.key === 'Backspace' || event.key === 'Delete') && deps.getSearchInput()?.value === '')) return false;
    if (isInputFocused() && document.activeElement !== deps.getSearchInput()) return true;
    if (deps.getBottomBar()?.isOpen()) {
      deps.getBottomBar()?.closeActionList();
      event.preventDefault();
      return true;
    }
    event.preventDefault();
    extensionManager.goBack();
    restoreSearchFocus();
    return true;
  }

  // Arrow keys and Enter when no extension view is open
  function tryHandleSearchNavigation(event: KeyboardEvent): boolean {
    if (viewManager.activeView) return false;
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

  // Enter while an extension view is open: submit to view or context provider
  function tryHandleViewEnter(event: KeyboardEvent): boolean {
    if (!viewManager.activeView || event.key !== 'Enter') return false;
    event.preventDefault();
    if (deps.getActiveContext()) {
      const queryToSubmit = deps.getContextQuery().trim();
      if (queryToSubmit) {
        logService.debug(`Submitting context query: "${queryToSubmit}"`);
        extensionManager.handleViewSubmit(queryToSubmit);
        contextModeService.updateQuery('');
        deps.setContextQuery('');
      }
    } else if (viewManager.activeViewSearchable && deps.getLocalSearchValue().trim()) {
      logService.debug(`Submitting to active view: "${deps.getLocalSearchValue()}"`);
      extensionManager.handleViewSubmit(deps.getLocalSearchValue());
      deps.setLocalSearchValue('');
    }
    return true;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (shortcutStore.isCapturing) return;
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
