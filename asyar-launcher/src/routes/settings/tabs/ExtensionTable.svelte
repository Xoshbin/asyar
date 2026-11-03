<script lang="ts">
  import { Input } from '../../../components';
  import { Toggle, EmptyState, LoadingState, Icon, Badge } from '../../../components';
  import KeyboardHint from '../../../components/base/KeyboardHint.svelte';
  import { aliasStore } from '../../../built-in-features/aliases/aliasStore.svelte';
  import { shortcutStore } from '../../../built-in-features/shortcuts/shortcutStore.svelte';
  import { toDisplayString } from '../../../built-in-features/shortcuts/shortcutFormatter';
  import type { SettingsHandler, ExtensionItem } from '../settingsHandlers.svelte';
  import { extensionStateManager } from '../../../services/extension/extensionStateManager.svelte';
  import { extensionUpdateService } from '../../../services/extension/extensionUpdateService.svelte';
  import {
    showOpenExtensionDialog,
    installExtensionFromFile,
    openStore,
    openCreateExtensionWithAi,
    openCreateExtension,
  } from '../../../lib/ipc/commands';
  import { filterExtensions, type ExtensionFilter, type ExtensionScope } from './extensionFilters';
  import type { HostCommand } from '../../../types/ExtendedManifest';
  import { t } from '../../../services/i18n';
  import AppIcon from '../../../components/base/AppIcon.svelte';
  import ExtensionCommandRows from './ExtensionCommandRows.svelte';
  let {
    handler,
    scope,
    onselect,
  }: {
    handler: SettingsHandler;
    scope: ExtensionScope;
    onselect: (ext: ExtensionItem, cmd?: HostCommand) => void;
  } = $props();

  const isThirdParty = $derived(scope === 'third-party');
  // Every built-in row is a built-in, so a Type column / filter chips would say nothing.
  const showType = $derived(isThirdParty);

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
      setTimeout(() => {
        installMessage = '';
        installError = false;
      }, 5000);
    }
  }

  // ── Table state ──────────────────────────────────────────────────────────
  let searchQuery = $state('');
  let activeFilter = $state<ExtensionFilter>('all');
  let expandedIds = $state<Set<string>>(new Set());
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
    filterExtensions(handler.extensions, searchQuery, activeFilter, scope),
  );

  // A single-command feature shows that command's alias and hotkey on its own row.
  function primaryAlias(ext: ExtensionItem): string | undefined {
    if (ext.commands?.length !== 1 || !ext.id) return undefined;
    return aliasStore.byObjectId.get(`cmd_${ext.id}_${ext.commands[0].id}`);
  }

  function primaryShortcut(ext: ExtensionItem): string | undefined {
    if (ext.commands?.length !== 1 || !ext.id) return undefined;
    const objectId = `cmd_${ext.id}_${ext.commands[0].id}`;
    return shortcutStore.shortcuts.find((sc) => sc.objectId === objectId)?.shortcut;
  }

  function getTypeLabel(ext: ExtensionItem): string {
    if (ext.isBuiltIn) return t('settings.extensions.type_builtin');
    if (ext.type === 'theme') return t('settings.extensions.type_theme');
    return t('settings.extensions.type_extension');
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  function selectExtension(ext: ExtensionItem) {
    onselect(ext);
  }

  function selectCommand(ext: ExtensionItem, cmd: HostCommand) {
    onselect(ext, cmd);
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

  const FILTERS: { id: ExtensionFilter; labelKey: string }[] = [
    { id: 'all', labelKey: 'settings.extensions.filter_all' },
    { id: 'commands', labelKey: 'settings.extensions.filter_commands' },
    { id: 'extension', labelKey: 'settings.extensions.filter_extensions' },
    { id: 'theme', labelKey: 'settings.extensions.filter_theme' },
  ];

  const visibleFilters = $derived(isThirdParty ? FILTERS : []);
</script>

{#snippet extensionRows(list: ExtensionItem[])}
  {#each list as ext (ext.id ?? ext.title)}
    {@const isExpanded = expandedIds.has(ext.id ?? ext.title)}
    {@const alias = primaryAlias(ext)}
    {@const hotkey = primaryShortcut(ext)}
    <div
      class="ext-row"
      role="row"
      tabindex="0"
      onclick={() => selectExtension(ext)}
      onkeydown={(e) => e.key === 'Enter' && selectExtension(ext)}
    >
      <div class="col-name row-name-cell">
        <button
          class="chevron"
          class:expanded={isExpanded}
          onclick={(e) => {
            e.stopPropagation();
            toggleExpand(ext.id ?? ext.title);
          }}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          disabled={!ext.commands?.length}
        >
          <svg
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="3,2 7,5 3,8" />
          </svg>
        </button>
        <div class="ext-icon shrink-0">
          <AppIcon icon={ext.icon} size={20} alt={ext.title}>
            {#snippet fallback()}
              <span class="ext-icon-letter">{ext.title[0]?.toUpperCase() ?? 'E'}</span>
            {/snippet}
          </AppIcon>
        </div>
        <div class="ext-info">
          <div class="ext-title-row">
            <span class="ext-title">{ext.title}</span>
            {#if ext.commands?.length}
              <span class="cmd-count-pill"
                >{ext.commands.length}
                {ext.commands.length === 1
                  ? t('settings.extensions.command_singular')
                  : t('settings.extensions.command_plural')}</span
              >
            {/if}
            {#if ext.id && extensionUpdateService.getUpdateForExtension(ext.id)}
              <button
                class="update-link"
                onclick={(e) => {
                  e.stopPropagation();
                  ext.id && handleUpdateExtension(ext.id);
                }}
                disabled={ext.id ? extensionUpdateService.isExtensionUpdating(ext.id) : false}
              >
                {ext.id && extensionUpdateService.isExtensionUpdating(ext.id)
                  ? 'Updating…'
                  : 'Update'}
              </button>
            {/if}
          </div>
          {#if ext.subtitle}
            <div class="ext-subtitle">{ext.subtitle}</div>
          {/if}
        </div>
      </div>
      {#if showType}
        <span class="col-type row-type">{getTypeLabel(ext)}</span>
      {/if}
      <span class="col-alias row-muted">
        {#if alias}<span class="alias-pill text-mono">{alias}</span>{:else}—{/if}
      </span>
      <span class="col-hotkey row-muted">
        {#if hotkey}<KeyboardHint keys={toDisplayString(hotkey)} />{:else}—{/if}
      </span>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="col-on"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        {#if ext.isBuiltIn && !ext.disableable}
          <Badge text={t('settings.extensions.always_on')} variant="default" />
        {:else}
          <Toggle
            checked={ext.isBuiltIn
              ? ext.disableable
                ? ext.enabled === true
                : true
              : ext.enabled === true}
            disabled={(ext.isBuiltIn && !ext.disableable) ||
              extensionStateManager.extensionUninstallInProgress === ext.id ||
              (ext.compatibility?.status !== 'compatible' &&
                ext.compatibility?.status !== 'unknown')}
            title={ext.isBuiltIn && !ext.disableable
              ? t('settings.extensions.required_builtin_explanation')
              : undefined}
            onchange={() => handler.toggleExtension(ext)}
          />
        {/if}
        <Icon name="chevron-right" size={14} class="row-drill-chevron" />
      </div>
    </div>
    {#if isExpanded && ext.commands?.length}
      <ExtensionCommandRows
        extension={ext}
        {showType}
        indented
        onselect={(cmd) => selectCommand(ext, cmd)}
      />
    {/if}
  {/each}
{/snippet}

<!-- ── Extensions table ─────────────────────────────────── -->
<div class="ext-shell">
  {#if isThirdParty && installMessage}
    <div
      class="install-banner"
      style="background: color-mix(in srgb, {installError
        ? 'var(--accent-danger)'
        : 'var(--accent-success)'} 12%, transparent);
             color: {installError ? 'var(--accent-danger)' : 'var(--accent-success)'};"
    >
      {installMessage}
    </div>
  {/if}

  {#if isThirdParty && updateCount > 0}
    <div class="update-banner">
      <span class="update-banner-text">
        {updateCount} extension{updateCount === 1 ? '' : 's'} can be updated
      </span>
      <button class="btn btn-primary" onclick={handleUpdateAll} disabled={isUpdatingAll}>
        {isUpdatingAll ? t('settings.extensions.updating') : t('settings.extensions.update_all')}
      </button>
    </div>
  {/if}

  <div class="section-header-row">
    <div class="section-heading">
      {#if isThirdParty}
        <div class="section-title">
          {t('settings.tabs.extensions')}
          <span class="section-count">{filteredExtensions.length}</span>
        </div>
      {:else}
        <div class="section-title">{t('settings.tabs.built_in_features')}</div>
        <div class="section-subtitle">{t('settings.extensions.built_in_subtitle')}</div>
      {/if}
    </div>
    <div class="toolbar-row">
      <div class="search-box">
        <Icon name="search" size={13} strokeWidth={2} class="search-icon" />
        <Input
          unstyled
          textIntent="exact"
          class="search-input"
          type="text"
          placeholder={t('settings.extensions.search_placeholder')}
          bind:value={searchQuery}
        />
      </div>

      {#each visibleFilters as f}
        <button
          class="filter-chip"
          class:active={activeFilter === f.id}
          onclick={() => {
            activeFilter = f.id;
          }}
        >
          {t(f.labelKey)}
        </button>
      {/each}

      {#if isThirdParty}
        <div class="plus-wrapper">
          <button
            class="plus-btn"
            aria-label={t('settings.extensions.add_extension')}
            bind:this={plusBtnEl}
            onclick={openPlusDropdown}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="left-panel" class:with-type={showType}>
    <!-- column headers -->
    <div class="col-headers">
      <span class="col-name">{t('settings.extensions.table_name')}</span>
      {#if showType}
        <span class="col-type">{t('settings.extensions.table_type')}</span>
      {/if}
      <span class="col-alias">{t('settings.extensions.table_alias')}</span>
      <span class="col-hotkey">{t('settings.extensions.table_hotkey')}</span>
      <span class="col-on">{t('settings.extensions.table_enabled')}</span>
    </div>

    <!-- table -->
    <div class="table-body">
      {#if handler.isLoadingExtensions}
        <LoadingState message={t('settings.extensions.loading_extensions')} />
      {:else if handler.extensionError}
        <EmptyState
          message={t('settings.extensions.failed_to_load')}
          description={handler.extensionError}
        >
          {#snippet icon()}<span style="font-size: var(--font-size-2xl); opacity: 0.5;">⚠️</span
            >{/snippet}
          <button class="btn btn-secondary" onclick={() => handler.loadExtensions()}
            >{t('common.retry')}</button
          >
        </EmptyState>
      {:else if filteredExtensions.length === 0}
        <EmptyState
          message={handler.extensions.length === 0
            ? t('settings.extensions.no_extensions')
            : t('search.no_results')}
          description={handler.extensions.length === 0
            ? t('settings.extensions.no_extensions_description')
            : t('settings.extensions.no_results_description')}
        />
      {:else}
        {@render extensionRows(filteredExtensions)}
      {/if}
    </div>
  </div>
</div>

{#if isThirdParty && plusOpen}
  <div class="plus-dropdown" style="top: {dropdownPos.top}px; right: {dropdownPos.right}px;">
    <div class="dd-section-label">{t('settings.extensions.filter_extensions')}</div>
    <button
      class="dd-item"
      onclick={() => {
        plusOpen = false;
        void openStore();
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {t('settings.extensions.browse_store')}
    </button>
    <button
      class="dd-item"
      onclick={() => {
        plusOpen = false;
        void handleInstallFromFile();
      }}
      disabled={isInstallingFromFile}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      {isInstallingFromFile ? 'Installing…' : t('settings.extensions.install_from_file')}
    </button>
    <div class="dd-separator"></div>
    <div class="dd-section-label">{t('settings.extensions.section_create')}</div>
    <button
      class="dd-item"
      onclick={() => {
        plusOpen = false;
        void openCreateExtensionWithAi();
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"
        />
      </svg>
      {t('settings.extensions.create_with_ai')}
    </button>
    <button
      class="dd-item"
      onclick={() => {
        plusOpen = false;
        void openCreateExtension();
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M12 8v8M8 12h8" />
      </svg>
      {t('settings.extensions.create_extension')}
    </button>
  </div>
{/if}

<style>
  /* ── Shell ────────────────────────────────────────── */
  /* Same frame as SettingsCard, so the table lines up with every card around it. */
  .left-panel {
    --ext-cols: 1fr 88px 112px 88px;
    display: flex;
    flex-direction: column;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .left-panel.with-type {
    --ext-cols: 1fr 80px 88px 112px 88px;
  }

  .ext-shell {
    display: flex;
    flex-direction: column;
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

  /* ── Section header + toolbar (search + chips + plus) ── */
  .section-header-row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    margin-bottom: var(--space-3);
  }

  .section-heading {
    min-width: 0;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .section-count {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .section-subtitle {
    margin-top: var(--space-1);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .toolbar-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    overflow-x: auto;
    flex-shrink: 0;
  }

  /* Hide the horizontal scrollbar on non-macOS only. On macOS, omitting
     the ::-webkit-scrollbar rule keeps WebKit's native NSScroller overlay
     (which fades out when not scrolling anyway). */
  html:not([data-platform='macos']) .toolbar-row::-webkit-scrollbar {
    display: none;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    background: var(--bg-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-3);
    height: 26px;
    flex: 1;
    max-width: 280px;
    min-width: 120px;
    transition: var(--transition-fast);
    box-sizing: border-box;
  }

  .search-box:focus-within {
    border-color: var(--accent-primary);
    box-shadow: var(--shadow-focus);
  }

  :global(.search-icon) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  :global(.search-input) {
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

  :global(.search-input)::placeholder {
    color: var(--text-tertiary);
  }

  .filter-chip {
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-full);
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--text-secondary);
    background: none;
    border: 1px solid var(--border-color);
    cursor: default;
    white-space: nowrap;
    transition: var(--transition-fast);
  }

  .filter-chip:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .filter-chip.active {
    background: var(--bg-selected);
    color: var(--text-primary);
    border-color: var(--border-color);
  }

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
    cursor: default;
    color: var(--text-secondary);
    transition: var(--transition-fast);
  }

  .plus-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .plus-btn:focus-visible {
    box-shadow: var(--shadow-focus);
  }

  .plus-btn svg {
    width: 14px;
    height: 14px;
  }

  .plus-dropdown {
    position: fixed;
    background: var(--bg-popup);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: var(--space-1) 0;
    min-width: 180px;
    z-index: var(--z-portal);
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
    cursor: default;
    text-align: left;
    transition: var(--transition-fast);
    font-family: var(--font-ui);
  }

  .dd-item:hover {
    background: var(--bg-hover);
  }
  .dd-item:focus-visible {
    box-shadow: var(--shadow-focus);
  }
  .dd-item svg {
    width: 13px;
    height: 13px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .dd-separator {
    height: 1px;
    background: var(--separator);
    margin: var(--space-1) 0;
  }

  /* ── Column headers ───────────────────────────────── */
  .col-headers {
    display: grid;
    grid-template-columns: var(--ext-cols);
    padding: var(--space-3) var(--space-6);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--separator);
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--text-tertiary);
  }

  .col-on {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
  }

  .col-on :global(.row-drill-chevron) {
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* ── Table body ───────────────────────────────────── */
  .table-body {
    flex: 1;
  }

  .table-body > :global(:last-child) {
    border-bottom: none;
  }

  /* ── Extension row ────────────────────────────────── */
  .ext-row {
    display: grid;
    grid-template-columns: var(--ext-cols);
    align-items: center;
    padding: var(--space-3) var(--space-6) var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--separator);
    cursor: default;
    transition: var(--transition-fast);
    outline: none;
  }

  .ext-row:hover {
    background: var(--bg-hover);
  }
  .ext-row.selected {
    background: var(--bg-selected);
  }
  .ext-row:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent-primary);
  }

  .row-name-cell {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

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
    cursor: default;
    color: var(--text-tertiary);
    padding: 0;
    transition: var(--transition-fast);
  }

  .chevron:disabled {
    opacity: 0;
    pointer-events: none;
  }
  .chevron svg {
    width: 11px;
    height: 11px;
    transition: var(--transition-fast);
  }
  .chevron.expanded svg {
    transform: rotate(90deg);
  }

  .ext-icon {
    width: var(--size-xl);
    height: var(--size-xl);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-tertiary));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--font-size-md);
    font-weight: 600;
    color: var(--text-secondary);
    overflow: hidden;
  }

  .ext-icon-letter {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--text-secondary);
  }

  .ext-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .ext-title-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .cmd-count-pill {
    flex-shrink: 0;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-xs);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
  }

  .ext-subtitle {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .alias-pill {
    display: inline-flex;
    align-items: center;
    padding: var(--space-0-5) var(--space-2);
    border-radius: var(--radius-xs);
    background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
    color: var(--text-secondary);
    font-size: var(--font-size-2xs);
    font-weight: 500;
  }

  .ext-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
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

  .row-muted {
    font-size: var(--font-size-sm);
    color: var(--text-tertiary);
  }

  .update-link {
    font-size: var(--font-size-xs);
    color: var(--accent-warning);
    background: none;
    border: none;
    cursor: default;
    padding: 0;
    flex-shrink: 0;
    transition: var(--transition-fast);
  }

  .update-link:hover {
    opacity: 0.8;
  }
</style>
