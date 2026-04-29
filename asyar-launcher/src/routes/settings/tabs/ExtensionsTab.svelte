<script lang="ts">
  import {
    SplitView,
    Toggle,
    EmptyState,
    LoadingState,
    ExtensionDetailPanel,
  } from '../../../components';
  import type { SettingsHandler, ExtensionItem } from '../settingsHandlers.svelte';
  import { extensionStateManager } from '../../../services/extension/extensionStateManager.svelte';
  import { extensionUpdateService } from '../../../services/extension/extensionUpdateService.svelte';
  import {
    showOpenExtensionDialog,
    installExtensionFromFile,
  } from '../../../lib/ipc/commands';
  import ShellTrustManager from '../../../components/settings/ShellTrustManager.svelte';
  import { filterExtensions, type ExtensionFilter } from './extensionFilters';
  import type { ExtensionCommand } from 'asyar-sdk/contracts';
  import { onMount } from 'svelte';
  import { aliasStore } from '../../../built-in-features/aliases/aliasStore.svelte';
  import { aliasService } from '../../../built-in-features/aliases/aliasService';
  import AliasCapture from '../../../built-in-features/aliases/AliasCapture.svelte';
  import ShortcutCapture from '../../../built-in-features/shortcuts/ShortcutCapture.svelte';
  import { shortcutStore, type ItemShortcut } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { shortcutService } from '../../../built-in-features/shortcuts/shortcutService';
  import { toDisplayString } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import KeyboardHint from '../../../components/base/KeyboardHint.svelte';
  import { logService } from '../../../services/log/logService';

  type AliasEditTarget = {
    objectId: string;
    name: string;
    currentAlias?: string;
  };

  type ShortcutEditTarget = {
    objectId: string;
    name: string;
  };

  let editingAliasTarget = $state<AliasEditTarget | null>(null);
  let editingShortcutTarget = $state<ShortcutEditTarget | null>(null);

  let shortcutsByObjectId = $derived(
    new Map<string, ItemShortcut>(
      shortcutStore.shortcuts.map((s) => [s.objectId, s])
    )
  );

  onMount(() => {
    void aliasStore.refresh().catch((e) => {
      logService.warn(`ExtensionsTab: failed to refresh alias store: ${e}`);
    });
  });

  function commandObjectId(extensionId: string, cmdId: string): string {
    return `cmd_${extensionId}_${cmdId}`;
  }

  function openAliasCaptureForCommand(ext: ExtensionItem, cmd: ExtensionCommand): void {
    if (!ext.id) return;
    const objectId = commandObjectId(ext.id, cmd.id);
    editingAliasTarget = {
      objectId,
      name: cmd.name,
      currentAlias: aliasStore.byObjectId.get(objectId),
    };
  }

  async function handleRemoveCommandAlias(ext: ExtensionItem, cmd: ExtensionCommand): Promise<void> {
    if (!ext.id) return;
    const alias = aliasStore.byObjectId.get(commandObjectId(ext.id, cmd.id));
    if (!alias) return;
    try {
      await aliasService.unregister(alias);
      aliasStore.removeOptimistic(alias);
    } catch (e) {
      logService.warn(`Failed to remove alias for ${cmd.name}: ${e}`);
    }
  }

  function openShortcutCaptureForCommand(ext: ExtensionItem, cmd: ExtensionCommand): void {
    if (!ext.id) return;
    editingShortcutTarget = {
      objectId: commandObjectId(ext.id, cmd.id),
      name: cmd.name,
    };
  }

  async function handleCommandShortcutSave(detail: { modifier: string; key: string }): Promise<string | true> {
    if (!editingShortcutTarget) return 'No command selected';
    const shortcut = `${detail.modifier}+${detail.key}`;
    const result = await shortcutService.register(
      editingShortcutTarget.objectId,
      editingShortcutTarget.name,
      'command',
      shortcut,
    );
    if (!result.ok) {
      const reason = result.conflict?.itemName ?? 'Unsupported key or OS error';
      return `Could not assign: ${reason}`;
    }
    return true;
  }

  async function handleRemoveCommandShortcut(ext: ExtensionItem, cmd: ExtensionCommand): Promise<void> {
    if (!ext.id) return;
    try {
      await shortcutService.unregister(commandObjectId(ext.id, cmd.id));
    } catch (e) {
      logService.warn(`Failed to remove shortcut for ${cmd.name}: ${e}`);
    }
  }

  let { handler }: { handler: SettingsHandler } = $props();

  // ── Update state (unchanged) ─────────────────────────────────────────────
  let updateCount = $derived(extensionUpdateService.updateCount);
  let isUpdatingAll = $derived(extensionUpdateService.isUpdatingAll);

  async function handleUpdateExtension(extensionId: string) {
    const update = extensionUpdateService.getUpdateForExtension(extensionId);
    if (!update) return;
    await extensionUpdateService.updateSingle(update, async () => handler.loadExtensions());
  }

  async function handleUpdateAll() {
    await extensionUpdateService.updateAll(async () => handler.loadExtensions());
  }

  // ── Install from file ────────────────────────────────────────────────────
  let isInstallingFromFile = $state(false);
  let installMessage = $state('');
  let installError = $state(false);

  async function handleInstallFromFile() {
    try {
      const filePath = await showOpenExtensionDialog();
      if (!filePath) return;
      isInstallingFromFile = true;
      installMessage = 'Installing extension…';
      installError = false;
      await installExtensionFromFile(filePath);
      installMessage = 'Extension installed successfully. Restart to activate.';
      if (handler.loadExtensions) await handler.loadExtensions();
    } catch (error) {
      installError = true;
      installMessage = `Installation failed: ${error}`;
    } finally {
      isInstallingFromFile = false;
      setTimeout(() => { installMessage = ''; installError = false; }, 5000);
    }
  }

  // ── Table state ──────────────────────────────────────────────────────────
  let searchQuery = $state('');
  let activeFilter = $state<ExtensionFilter>('all');
  let expandedIds = $state<Set<string>>(new Set());
  let selectedExtensionId = $state<string | null>(null);
  let selectedCommandId = $state<string | null>(null);
  let plusOpen = $state(false);
  let plusBtnEl = $state<HTMLButtonElement | undefined>(undefined);
  let dropdownPos = $state({ top: 0, right: 0 });

  function openPlusDropdown(e: MouseEvent) {
    e.stopPropagation();
    if (!plusOpen && plusBtnEl) {
      const rect = plusBtnEl.getBoundingClientRect();
      dropdownPos = {
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      };
    }
    plusOpen = !plusOpen;
  }

  let filteredExtensions = $derived(
    filterExtensions(handler.extensions, searchQuery, activeFilter),
  );

  let selectedExtension = $derived(
    handler.extensions.find(e => (e.id ?? e.title) === selectedExtensionId) ?? null,
  );

  let selectedCommand = $derived.by<{ cmd: ExtensionCommand; parent: ExtensionItem } | null>(() => {
    if (!selectedCommandId || !selectedExtensionId) return null;
    const ext = handler.extensions.find(e => (e.id ?? e.title) === selectedExtensionId);
    const cmd = ext?.commands?.find(c => c.id === selectedCommandId);
    return cmd && ext ? { cmd, parent: ext } : null;
  });

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedIds = next;
  }

  function selectExtension(ext: ExtensionItem) {
    selectedExtensionId = ext.id ?? ext.title;
    selectedCommandId = null;
  }

  function selectCommand(ext: ExtensionItem, cmd: ExtensionCommand) {
    selectedExtensionId = ext.id ?? ext.title;
    selectedCommandId = cmd.id;
  }

  // Close plus dropdown when user clicks anywhere else
  $effect(() => {
    if (!plusOpen) return;
    const close = (e: MouseEvent) => {
      plusOpen = false;
    };
    // defer so the opening click doesn't immediately close
    const id = setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  });

  const FILTERS: { id: ExtensionFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'commands', label: 'Commands' },
    { id: 'extension', label: 'Extensions' },
    { id: 'theme', label: 'Theme' },
  ];
</script>

<!-- ── Extensions table + detail panel ─────────────────────────────────── -->
<div class="ext-shell">

  {#if installMessage}
    <div
      class="install-banner"
      style="background: color-mix(in srgb, {installError ? 'var(--accent-danger)' : 'var(--accent-success)'} 12%, transparent);
             color: {installError ? 'var(--accent-danger)' : 'var(--accent-success)'};"
    >
      {installMessage}
    </div>
  {/if}

  {#if updateCount > 0}
    <div class="update-banner">
      <span class="update-banner-text">
        {updateCount} extension{updateCount === 1 ? '' : 's'} can be updated
      </span>
      <button class="btn btn-primary" onclick={handleUpdateAll} disabled={isUpdatingAll}>
        {isUpdatingAll ? 'Updating…' : 'Update All'}
      </button>
    </div>
  {/if}

  <SplitView leftWidth="66%" minLeftWidth={340} maxLeftWidth={720}>
    {#snippet left()}
      <div class="left-panel">
      <!-- toolbar: search + filter chips + plus button -->
      <div class="toolbar-row">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            class="search-input"
            type="text"
            placeholder="Search…"
            bind:value={searchQuery}
          />
        </div>

        {#each FILTERS as f}
          <button
            class="filter-chip"
            class:active={activeFilter === f.id}
            onclick={() => { activeFilter = f.id; }}
          >
            {f.label}
          </button>
        {/each}

        <div class="plus-wrapper">
          <button
            class="plus-btn"
            aria-label="Add extension"
            bind:this={plusBtnEl}
            onclick={openPlusDropdown}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- column headers -->
      <div class="col-headers">
        <span class="col-name">Name</span>
        <span class="col-type">Type</span>
        <span class="col-alias">Alias</span>
        <span class="col-hotkey">Hotkey</span>
        <span class="col-on">Enabled</span>
      </div>

      <!-- table -->
      <div class="table-body custom-scrollbar">
        {#if handler.isLoadingExtensions}
          <LoadingState message="Loading extensions…" />
        {:else if handler.extensionError}
          <EmptyState message="Failed to load extensions" description={handler.extensionError}>
            {#snippet icon()}<span style="font-size: var(--font-size-2xl); opacity: 0.5;">⚠️</span>{/snippet}
            <button class="btn btn-secondary" onclick={() => handler.loadExtensions()}>Retry</button>
          </EmptyState>
        {:else if filteredExtensions.length === 0}
          <EmptyState
            message={handler.extensions.length === 0 ? 'No extensions installed' : 'No results'}
            description={handler.extensions.length === 0 ? 'Extensions add new functionality to Asyar' : 'Try a different search or filter'}
          />
        {:else}
          {#each filteredExtensions as ext (ext.id ?? ext.title)}
            {@const isExpanded = expandedIds.has(ext.id ?? ext.title)}
            {@const isExtSelected = selectedExtensionId === (ext.id ?? ext.title) && !selectedCommandId}

            <!-- extension row -->
            <div
              class="ext-row"
              class:selected={isExtSelected}
              role="row"
              tabindex="0"
              onclick={() => selectExtension(ext)}
              onkeydown={(e) => e.key === 'Enter' && selectExtension(ext)}
            >
              <div class="col-name row-name-cell">
                <button
                  class="chevron"
                  class:expanded={isExpanded}
                  onclick={(e) => { e.stopPropagation(); toggleExpand(ext.id ?? ext.title); }}
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  disabled={!ext.commands?.length}
                >
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3,2 7,5 3,8"/>
                  </svg>
                </button>
                <div class="ext-icon shrink-0">
                  {#if ext.iconUrl}
                    <img src={ext.iconUrl} alt={ext.title} class="ext-icon-img" />
                  {:else}
                    {ext.title[0]?.toUpperCase() ?? 'E'}
                  {/if}
                </div>
                <span class="ext-title">{ext.title}</span>
                {#if ext.id && extensionUpdateService.getUpdateForExtension(ext.id)}
                  <button
                    class="update-link"
                    onclick={(e) => { e.stopPropagation(); ext.id && handleUpdateExtension(ext.id); }}
                    disabled={ext.id ? extensionUpdateService.isExtensionUpdating(ext.id) : false}
                  >
                    {ext.id && extensionUpdateService.isExtensionUpdating(ext.id) ? 'Updating…' : 'Update'}
                  </button>
                {/if}
              </div>
              <span class="col-type row-type">{ext.type ?? '—'}</span>
              <span class="col-alias row-muted">—</span>
              <span class="col-hotkey row-muted">—</span>
              <div class="col-on">
                <Toggle
                  checked={ext.enabled === true}
                  disabled={handler.togglingExtension === ext.title ||
                    extensionStateManager.extensionUninstallInProgress === ext.id ||
                    (ext.compatibility?.status !== 'compatible' && ext.compatibility?.status !== 'unknown')}
                  onchange={() => handler.toggleExtension(ext)}
                />
              </div>
            </div>

            <!-- command rows (shown when expanded) -->
            {#if isExpanded && ext.commands?.length}
              {#each ext.commands as cmd (cmd.id)}
                {@const isCmdSelected = selectedCommandId === cmd.id && selectedExtensionId === ext.id}
                {@const cmdObjId = ext.id ? commandObjectId(ext.id, cmd.id) : ''}
                {@const cmdAlias = cmdObjId ? aliasStore.byObjectId.get(cmdObjId) : undefined}
                {@const cmdShortcut = cmdObjId ? shortcutsByObjectId.get(cmdObjId) : undefined}
                <div
                  class="cmd-row"
                  class:selected={isCmdSelected}
                  role="row"
                  tabindex="0"
                  onclick={() => selectCommand(ext, cmd)}
                  onkeydown={(e) => e.key === 'Enter' && selectCommand(ext, cmd)}
                >
                  <div class="col-name row-name-cell cmd-indent">
                    <div class="cmd-icon shrink-0">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                      </svg>
                    </div>
                    <span class="ext-title">{cmd.name}</span>
                  </div>
                  <span class="col-type row-type">Command</span>
                  <span class="col-alias">
                    {#if cmdAlias}
                      <button
                        type="button"
                        class="alias-cell-btn"
                        onclick={(e) => { e.stopPropagation(); openAliasCaptureForCommand(ext, cmd); }}
                        title="Change alias"
                      >
                        <span class="alias-pill text-mono">{cmdAlias}</span>
                      </button>
                      <button
                        type="button"
                        class="clear-btn"
                        aria-label="Remove alias for {cmd.name}"
                        onclick={(e) => { e.stopPropagation(); handleRemoveCommandAlias(ext, cmd); }}
                      >
                        ✕
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="row-action-btn"
                        onclick={(e) => { e.stopPropagation(); openAliasCaptureForCommand(ext, cmd); }}
                      >
                        Add Alias
                      </button>
                    {/if}
                  </span>
                  <span class="col-hotkey">
                    {#if cmdShortcut}
                      <button
                        type="button"
                        class="alias-cell-btn"
                        onclick={(e) => { e.stopPropagation(); openShortcutCaptureForCommand(ext, cmd); }}
                        title="Reassign hotkey"
                      >
                        <KeyboardHint keys={toDisplayString(cmdShortcut.shortcut)} />
                      </button>
                      <button
                        type="button"
                        class="clear-btn"
                        aria-label="Remove hotkey for {cmd.name}"
                        onclick={(e) => { e.stopPropagation(); handleRemoveCommandShortcut(ext, cmd); }}
                      >
                        ✕
                      </button>
                    {:else}
                      <button
                        type="button"
                        class="row-action-btn"
                        onclick={(e) => { e.stopPropagation(); openShortcutCaptureForCommand(ext, cmd); }}
                      >
                        Record Hotkey
                      </button>
                    {/if}
                  </span>
                  <span class="col-on row-check">✓</span>
                </div>
              {/each}
            {/if}
          {/each}
        {/if}
      </div>
      </div>
    {/snippet}

    {#snippet right()}
      <div class="detail-panel custom-scrollbar">
        <ExtensionDetailPanel
          extension={selectedCommand ? null : selectedExtension}
          command={selectedCommand}
          isToggling={handler.togglingExtension !== null}
          isUninstalling={extensionStateManager.extensionUninstallInProgress !== null}
          preferencesVersion={handler.preferencesVersion}
          onToggle={(ext) => handler.toggleExtension(ext)}
          onUninstall={(ext) => handler.requestUninstallExtension(ext)}
        />
      </div>
    {/snippet}
  </SplitView>
</div>

{#if plusOpen}
  <div
    class="plus-dropdown"
    style="top: {dropdownPos.top}px; right: {dropdownPos.right}px;"
  >
    <div class="dd-section-label">Extensions</div>
    <button
      class="dd-item"
      onclick={() => { plusOpen = false; handleInstallFromFile(); }}
      disabled={isInstallingFromFile}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      {isInstallingFromFile ? 'Installing…' : 'Install from File…'}
    </button>
    <div class="dd-separator"></div>
    <div class="dd-section-label">Create</div>
    <button class="dd-item dd-item-disabled" disabled title="Coming soon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M12 8v8M8 12h8"/>
      </svg>
      Create Extension
    </button>
  </div>
{/if}

<ShellTrustManager />

{#if editingAliasTarget}
  <AliasCapture
    objectId={editingAliasTarget.objectId}
    itemName={editingAliasTarget.name}
    itemType="command"
    currentAlias={editingAliasTarget.currentAlias}
    onsave={() => (editingAliasTarget = null)}
    oncancel={() => (editingAliasTarget = null)}
  />
{/if}

{#if editingShortcutTarget}
  <ShortcutCapture
    onsave={handleCommandShortcutSave}
    oncancel={() => (editingShortcutTarget = null)}
    ondone={() => (editingShortcutTarget = null)}
    excludeObjectId={editingShortcutTarget.objectId}
  />
{/if}

<style>
  /* ── Shell ────────────────────────────────────────── */
  .left-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .ext-shell {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  /* ── Banners ──────────────────────────────────────── */
  .install-banner {
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-sm);
    margin: var(--space-3) var(--space-4) 0;
  }

  .update-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) var(--space-4);
    margin: var(--space-3) var(--space-4) 0;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-warning) 12%, transparent);
  }

  .update-banner-text {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  /* ── Toolbar row (search + chips + plus) ─────────── */
  .toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--separator);
    overflow-x: auto;
    flex-shrink: 0;
  }

  /* Hide the horizontal scrollbar on non-macOS only. On macOS, omitting
     the ::-webkit-scrollbar rule keeps WebKit's native NSScroller overlay
     (which fades out when not scrolling anyway). */
  html:not([data-platform="macos"]) .toolbar-row::-webkit-scrollbar { display: none; }

  .search-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-3);
    height: 26px;
    width: 150px;
    flex-shrink: 1;
    min-width: 80px;
    transition: var(--transition-fast);
    box-sizing: border-box;
  }

  .search-box:focus-within {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  .search-icon {
    width: 13px;
    height: 13px;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    font-family: var(--font-ui);
    line-height: 1;
    height: 100%;
    padding: 0;
  }

  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .filter-chip {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-xs);
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-secondary);
    background: none;
    border: none;
    cursor: pointer;
    white-space: nowrap;
    transition: var(--transition-fast);
  }

  .filter-chip:hover { background: var(--bg-hover); color: var(--text-primary); }
  .filter-chip.active { background: var(--bg-selected); color: var(--text-primary); }

  /* ── Plus button + dropdown ───────────────────────── */
  .plus-wrapper {
    position: relative;
    margin-left: auto;
    flex-shrink: 0;
  }

  .plus-btn {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-secondary);
    transition: var(--transition-fast);
  }

  .plus-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .plus-btn:focus-visible { box-shadow: var(--shadow-focus); }

  .plus-btn svg { width: 14px; height: 14px; }

  .plus-dropdown {
    position: fixed;
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-1) 0;
    min-width: 180px;
    z-index: 9999;
    box-shadow: var(--shadow-popup);
  }

  .dd-section-label {
    padding: var(--space-1) var(--space-3) var(--space-1);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--text-tertiary);
  }

  .dd-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: var(--transition-fast);
    font-family: var(--font-ui);
  }

  .dd-item:hover { background: var(--bg-hover); }
  .dd-item:focus-visible { box-shadow: var(--shadow-focus); }
  .dd-item svg { width: 13px; height: 13px; color: var(--text-secondary); flex-shrink: 0; }

  .dd-item-disabled {
    color: var(--text-tertiary);
    cursor: not-allowed;
  }

  .dd-item-disabled:hover { background: none; }

  .dd-separator {
    height: 1px;
    background: var(--separator);
    margin: var(--space-1) 0;
  }

  /* ── Column headers ───────────────────────────────── */
  .col-headers {
    display: grid;
    grid-template-columns: 1fr 80px 72px 96px 48px;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--separator);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .col-on { text-align: center; }

  /* ── Table body ───────────────────────────────────── */
  .table-body {
    flex: 1;
    overflow-y: auto;
  }

  /* ── Extension row ────────────────────────────────── */
  .ext-row {
    display: grid;
    grid-template-columns: 1fr 80px 72px 96px 48px;
    align-items: center;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    cursor: pointer;
    transition: var(--transition-fast);
    outline: none;
  }

  .ext-row:hover { background: var(--bg-hover); }
  .ext-row.selected { background: var(--bg-selected); }
  .ext-row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-primary); }

  .row-name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  /* ── Command row ──────────────────────────────────── */
  .cmd-row {
    display: grid;
    grid-template-columns: 1fr 80px 72px 96px 48px;
    align-items: center;
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2);
    cursor: pointer;
    transition: var(--transition-fast);
    outline: none;
  }

  .cmd-row:hover { background: var(--bg-hover); }
  .cmd-row.selected { background: var(--bg-selected); }
  .cmd-row:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-primary); }

  .cmd-indent { padding-left: calc(var(--space-8) + var(--space-2)); }

  /* ── Row cells ────────────────────────────────────── */
  .chevron {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 0;
    transition: var(--transition-fast);
  }

  .chevron:disabled { opacity: 0; pointer-events: none; }
  .chevron svg { width: 11px; height: 11px; transition: var(--transition-fast); }
  .chevron.expanded svg { transform: rotate(90deg); }

  .ext-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .ext-icon-img { width: 18px; height: 18px; }

  .cmd-icon {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-xs);
    background: var(--bg-tertiary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .cmd-icon svg { width: 12px; height: 12px; color: var(--text-tertiary); }

  .ext-title {
    font-size: var(--font-size-sm);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-type {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }

  .row-muted {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .row-check {
    font-size: var(--font-size-sm);
    color: var(--accent-primary);
    text-align: center;
  }

  .update-link {
    font-size: var(--font-size-xs);
    color: var(--accent-warning);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
    transition: var(--transition-fast);
  }

  .update-link:hover { opacity: 0.8; }

  /* ── Detail panel ─────────────────────────────────── */
  .detail-panel {
    height: 100%;
    overflow-y: auto;
  }

  /* ── Alias cell controls ──────────────────────────── */
  .alias-cell-btn,
  .row-action-btn {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: var(--font-size-xs);
  }

  .row-action-btn:hover {
    color: var(--accent-primary);
    text-decoration: underline;
  }

  .clear-btn {
    background: transparent;
    border: none;
    padding: 0;
    margin-left: var(--space-1);
    cursor: pointer;
    color: var(--text-tertiary);
    font-size: var(--font-size-xs);
    line-height: 1;
  }

  .clear-btn:hover {
    color: var(--accent-danger);
  }

  .alias-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 18px;
    min-width: 18px;
    padding: 0 6px;
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    user-select: none;
  }

</style>
