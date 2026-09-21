<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import type { AppWindowInfo } from '../../bindings';
  import { windowManagementService } from '../../services/windowManagement/windowManagementService';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { isAnyModalOpen } from '../../components/base/Modal.logic';
  import { LauncherListRow, Badge, EmptyState, LoadingState } from '../../components';
  import { hideWindow } from '../../lib/ipc/commands';
  import { resetLauncherState } from '../../lib/launcher/launcherReset';
  import { writeText } from 'tauri-plugin-clipboard-x-api';

  interface Props {
    extensionManager?: any;
  }
  let { extensionManager }: Props = $props();

  let windows = $state<AppWindowInfo[]>([]);
  let isLoading = $state(true);
  let selectedIndex = $state(0);
  let listContainer = $state<HTMLElement | null>(null);

  const query = $derived(searchStores.query.trim().toLowerCase());
  const filteredWindows = $derived.by(() => {
    if (!query) return windows;
    return windows.filter(
      (w) => w.title.toLowerCase().includes(query) || w.appName.toLowerCase().includes(query),
    );
  });

  const selectedWindow = $derived(filteredWindows[selectedIndex] ?? null);

  $effect(() => {
    if (filteredWindows.length === 0) {
      selectedIndex = 0;
    } else if (selectedIndex >= filteredWindows.length) {
      selectedIndex = filteredWindows.length - 1;
    }
  });

  async function refreshWindows() {
    try {
      isLoading = true;
      windows = await windowManagementService.listWindows();
    } catch (err: any) {
      logService.error(`[SwitchWindowsView] listWindows failed: ${err}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Failed to list windows: ${err?.message ?? err}` },
      });
    } finally {
      isLoading = false;
    }
  }

  async function handleFocus(id: string) {
    try {
      await windowManagementService.focusWindow(id);
      await hideWindow();
      resetLauncherState();
    } catch (err: any) {
      logService.error(`[SwitchWindowsView] focusWindow failed: ${err}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not switch to window: ${err?.message ?? err}` },
      });
    }
  }

  async function handleClose(id: string) {
    try {
      await windowManagementService.closeWindow(id);
      await refreshWindows();
    } catch (err: any) {
      logService.error(`[SwitchWindowsView] closeWindow failed: ${err}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not close window: ${err?.message ?? err}` },
      });
    }
  }

  async function handleCopyTitle(title: string) {
    try {
      await writeText(title);
      await feedbackService.showHUD(t('features.window_management.title_copied'));
    } catch (err: any) {
      logService.error(`[SwitchWindowsView] copy title failed: ${err}`);
      await feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: `Could not copy title: ${err?.message ?? err}` },
      });
    }
  }

  function scrollToSelected() {
    tick().then(() => {
      const selectedEl = listContainer?.querySelector('.selected-result');
      if (typeof selectedEl?.scrollIntoView === 'function') {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function handleKeydown(event: KeyboardEvent) {
    if (isAnyModalOpen(document)) return;
    if (filteredWindows.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex + 1) % filteredWindows.length;
      scrollToSelected();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex - 1 + filteredWindows.length) % filteredWindows.length;
      scrollToSelected();
    } else if (event.key === 'Enter') {
      if (selectedWindow) {
        event.preventDefault();
        event.stopPropagation();
        void handleFocus(selectedWindow.id);
      }
    }
  }

  $effect(() => {
    const current = selectedWindow;
    if (!current) {
      actionService.unregisterAction('window-management:focus-window');
      actionService.unregisterAction('window-management:close-window');
      actionService.unregisterAction('window-management:copy-title');
      return;
    }

    const id = current.id;
    const title = current.title;

    actionService.registerAction({
      id: 'window-management:focus-window',
      title: t('features.window_management.focus_window'),
      icon: 'icon:window',
      shortcut: '↵',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleFocus(id),
    });

    actionService.registerAction({
      id: 'window-management:close-window',
      title: t('features.window_management.close_window'),
      icon: 'icon:x',
      shortcut: '⌘W',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleClose(id),
    });

    actionService.registerAction({
      id: 'window-management:copy-title',
      title: t('features.window_management.copy_title'),
      icon: 'icon:copy',
      shortcut: '⌘C',
      extensionId: 'window-management',
      category: 'window-management',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => handleCopyTitle(title),
    });

    return () => {
      actionService.unregisterAction('window-management:focus-window');
      actionService.unregisterAction('window-management:close-window');
      actionService.unregisterAction('window-management:copy-title');
    };
  });

  onMount(() => {
    extensionManager?.setActiveViewActionLabel(t('features.window_management.focus_window'));
    void refreshWindows();
    window.addEventListener('keydown', handleKeydown, true);
  });

  onDestroy(() => {
    extensionManager?.setActiveViewActionLabel(null);
    window.removeEventListener('keydown', handleKeydown, true);
    actionService.unregisterAction('window-management:focus-window');
    actionService.unregisterAction('window-management:close-window');
    actionService.unregisterAction('window-management:copy-title');
  });
</script>

<div class="view-container">
  <div class="list custom-scrollbar" bind:this={listContainer}>
    {#if isLoading && windows.length === 0}
      <LoadingState />
    {:else if windows.length === 0}
      <EmptyState message={t('features.window_management.no_windows')} description="" />
    {:else if filteredWindows.length === 0}
      <EmptyState message={t('features.window_management.no_matching_windows')} description="" />
    {:else}
      {#each filteredWindows as win, index (win.id)}
        <LauncherListRow
          title={win.title || win.appName}
          subtitle={win.appName}
          icon={win.appIcon ?? 'icon:window'}
          selected={selectedIndex === index}
          onclick={() => {
            selectedIndex = index;
            void handleFocus(win.id);
          }}
        >
          {#snippet trailing()}
            <div class="trailing-badges">
              {#if win.isFocused}
                <Badge text={t('features.window_management.badge_active')} variant="info" />
              {/if}
              {#if win.isMinimized}
                <Badge text={t('features.window_management.badge_minimized')} variant="default" />
              {/if}
            </div>
          {/snippet}
        </LauncherListRow>
      {/each}
    {/if}
  </div>
</div>

<style>
  .view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .trailing-badges {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-left: auto;
    flex-shrink: 0;
  }
</style>
