<script lang="ts">
  import {
    actionService,
    type ApplicationAction,
  } from '../../services/action/actionService.svelte';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import extensionManager from '../../services/extension/extensionManager.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { platform } from '@tauri-apps/plugin-os';
  import PrimaryActionDisplay from './PrimaryActionDisplay.svelte';
  import BottomBarButton from './BottomBarButton.svelte';
  import FeedbackBar from './FeedbackBar.svelte';
  import StatusDot from '../base/StatusDot.svelte';
  import InformationPanel from './InformationPanel.svelte';
  import ShowMoreBarHuds from './ShowMoreBarHuds.svelte';

  // On macOS the Show More bar is rendered natively (NSView) so its setHidden:
  // commits atomically with NSWindow setFrame: — see platform/macos.rs.
  // Windows/Linux fall back to the Svelte-rendered overlay below.
  const IS_MACOS = (() => {
    try {
      return platform() === 'macos';
    } catch {
      return false;
    }
  })();

  let {
    selectedItem = null,
    isActionListOpen = false,
    isCompactIdle = false,
    argumentValidationError = null,
    onactionListToggled,
    onactionListClosed,
    onexpand,
  }: {
    selectedItem?: SearchResult | null;
    isActionListOpen: boolean;
    isCompactIdle?: boolean;
    /**
     * Chip-row input the user has entered wrongly. Transient UI state rather
     * than a published diagnostic, so it renders in the feedback slot without
     * going through feedbackService — nothing here is worth keeping in
     * history, and it clears itself as soon as the value parses.
     */
    argumentValidationError?: string | null;
    onactionListToggled: () => void;
    onactionListClosed: () => void;
    onexpand?: () => void;
  } = $props();

  let availableActions = $derived(actionService.filteredActions);

  let enrichedActionsInternal = $derived(
    availableActions.map((action) => ({
      ...action,
      displayCategory:
        action.category ??
        (action.extensionId
          ? (extensionManager.getManifestById(action.extensionId)?.name ?? action.extensionId)
          : null) ??
        'Actions',
    })),
  );

  // Inside an extension view the bottom-left shows the active extension;
  // diagnostics take precedence when present.
  let activeViewManifest = $derived.by(() => {
    const view = viewManager.activeView;
    if (!view) return null;
    const extensionId = view.split('/')[0];
    return extensionManager.getManifestById(extensionId) ?? null;
  });
  let hasFeedback = $derived(feedbackService.current !== null);

  export function getEnrichedActions() {
    return enrichedActionsInternal;
  }

  // Legacy compat functions for LauncherController
  export function toggleActionList() {
    onactionListToggled();
  }
  export function closeActionList() {
    if (isActionListOpen) onactionListClosed();
  }
  export function isOpen(): boolean {
    return isActionListOpen;
  }

  function handleActionClick() {
    onactionListToggled();
  }
</script>

<!--
  Both bars are always mounted at fixed positions — compact↔expanded never
  changes DOM layout. macOS: bottom bar is cropped away by NSWindow in compact.
  Non-macOS: hidden via CSS since the window really shrinks.
-->
<div
  class="fixed bottom-0 left-0 right-0 z-40 h-10 border-t border-[var(--border-color)] flex items-center justify-between px-3 bottom-action-bar"
  class:is-compact={isCompactIdle}
  style="background-color: var(--bg-secondary-full-opacity);"
>
  <div class="flex-1 min-w-0 flex items-center gap-3">
    {#if argumentValidationError}
      <!-- Takes the slot while the user is mid-entry: what they just typed is
           more immediate than anything already sitting there. -->
      <div class="arg-validation" role="status">
        <StatusDot color="danger" />
        {#if argumentValidationError.startsWith('Required  ')}
          <!-- Prefix matches missingArgumentNotice exactly; change together. -->
          <span class="arg-validation-text"
            ><strong>Required</strong>{argumentValidationError.slice('Required'.length)}</span
          >
        {:else}
          <span class="arg-validation-text">{argumentValidationError}</span>
        {/if}
      </div>
    {:else if hasFeedback}
      <FeedbackBar />
    {:else if activeViewManifest}
      <InformationPanel {activeViewManifest} />
    {/if}
  </div>

  <div class="flex items-center gap-3 flex-shrink-0">
    <PrimaryActionDisplay
      {selectedItem}
      activeViewLabel={viewManager.activeViewPrimaryActionLabel}
    />

    {#if selectedItem || viewManager.activeViewPrimaryActionLabel}
      <span aria-hidden="true" class="bottom-bar-separator"></span>
    {/if}

    <BottomBarButton
      label="Actions"
      keyHint={['⌘', 'K']}
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
  <div
    class="fixed left-0 right-0 z-40 h-10 flex items-center justify-between gap-3 px-3 show-more-bar"
    class:is-visible={isCompactIdle}
    style="top: 56px; background-color: var(--bg-secondary-full-opacity);"
  >
    <ShowMoreBarHuds />
    <BottomBarButton label="Show More" keyHint="↓" onclick={() => onexpand?.()} />
  </div>
{/if}

<style>
  :global(html:not([data-platform='macos'])) .bottom-action-bar.is-compact {
    display: none;
  }
  .show-more-bar {
    visibility: hidden;
  }
  .show-more-bar.is-visible {
    visibility: visible;
  }

  /* Sits in the feedback slot but carries its own tinted pill: this is the
     user's own input to fix, not a diagnostic about the app. */
  .arg-validation {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: 3px var(--space-3);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-danger) 12%, transparent);
    color: var(--accent-danger);
    font-size: var(--font-size-xs);
  }
  /* pre, not nowrap: same single line, but the double space after the bold
     Required label survives collapsing. */
  .arg-validation-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
  }

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
