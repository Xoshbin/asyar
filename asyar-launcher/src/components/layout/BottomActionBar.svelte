<script lang="ts">
  import { actionService, type ApplicationAction } from '../../services/action/actionService.svelte';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { searchStores } from '../../services/search/stores/search.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import BottomBarButton from './BottomBarButton.svelte';
  import DiagnosticBar from './DiagnosticBar.svelte';

  // On macOS the Show More bar is rendered natively (NSView) so its setHidden:
  // commits atomically with NSWindow setFrame: — see platform/macos.rs.
  // Windows/Linux fall back to the Svelte-rendered overlay below.
  const IS_MACOS = (() => {
    try { return platform() === 'macos'; } catch { return false; }
  })();

  let {
    selectedItem = null,
    isActionListOpen = false,
    isCompactIdle = false,
    onactionListToggled,
    onactionListClosed,
    onexpand,
  }: {
    selectedItem?: SearchResult | null;
    isActionListOpen: boolean;
    isCompactIdle?: boolean;
    onactionListToggled: () => void;
    onactionListClosed: () => void;
    onexpand?: () => void;
  } = $props();

  let availableActions = $derived(actionService.filteredActions);

  let enrichedActionsInternal = $derived(availableActions.map(action => ({
    ...action,
    displayCategory: action.category
      ?? (action.extensionId ? (extensionManager.getManifestById(action.extensionId)?.name ?? action.extensionId) : null)
      ?? 'Actions'
  })));

  export function getEnrichedActions() {
    return enrichedActionsInternal;
  }

  // Legacy compat functions for LauncherController
  export function toggleActionList() { onactionListToggled(); }
  export function closeActionList() { if (isActionListOpen) onactionListClosed(); }
  export function isOpen(): boolean { return isActionListOpen; }

  function handleActionClick() {
    onactionListToggled();
  }
</script>

<!--
  Both bars are always mounted at fixed positions — compact↔expanded never
  changes DOM layout. macOS: bottom bar is cropped away by NSWindow in compact.
  Non-macOS: hidden via CSS since the window really shrinks.
-->
<div class="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-between px-3 bottom-action-bar"
     class:is-compact={isCompactIdle}
     style="background-color: var(--bg-secondary-full-opacity);">
  <div class="flex-1 min-w-0 flex items-center gap-3">
    <DiagnosticBar />
  </div>

  <div class="flex items-center gap-3 flex-shrink-0">
    {#if searchStores.isLoading}
      <div class="text-xs text-[var(--text-secondary)] px-2 animate-pulse">Loading...</div>
    {/if}

    <PrimaryActionDisplay {selectedItem} activeViewLabel={viewManager.activeViewPrimaryActionLabel} />

    {#if selectedItem || viewManager.activeViewPrimaryActionLabel}
      <span aria-hidden="true" class="bottom-bar-separator"></span>
    {/if}

    <BottomBarButton
      label="Actions"
      keyHint={["⌘", "K"]}
      onclick={handleActionClick}
      ariaHaspopup="true"
      ariaExpanded={isActionListOpen}
    />
  </div>
</div>

<!--
  macOS renders this bar natively (platform/macos.rs → `show_more_bar` module)
  for atomic setFrame+setHidden. Non-macOS uses the Svelte overlay below.

  KEEP IN SYNC: any visual change here (label text, keyboard hint, colors,
  typography, spacing, extra buttons) MUST be mirrored in the native bar at
  src-tauri/src/platform/macos.rs `mod show_more_bar`. The two implementations
  have no automatic sync — nativeBarSync.ts pushes CSS-variable colors over,
  but layout and structure are hardcoded on each side.
-->
{#if !IS_MACOS}
  <div class="fixed left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-end px-3 show-more-bar"
       class:is-visible={isCompactIdle}
       style="top: 56px; background-color: var(--bg-secondary-full-opacity);">
    <BottomBarButton
      label="Show More"
      keyHint="↓"
      onclick={() => onexpand?.()}
    />
  </div>
{/if}

<style>
  :global(html:not([data-platform="macos"])) .bottom-action-bar.is-compact {
    display: none;
  }
  .show-more-bar { visibility: hidden; }
  .show-more-bar.is-visible { visibility: visible; }

  /* Thin vertical divider between primary action and Actions cluster. */
  .bottom-bar-separator {
    display: inline-block;
    width: 2px;
    height: 11px;
    border-radius: 1px;
    background-color: var(--separator);
    flex-shrink: 0;
  }
</style>
