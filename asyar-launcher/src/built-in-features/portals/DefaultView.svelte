<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { writeText as writeClipboardText } from 'tauri-plugin-clipboard-x-api';
  import {
    AppIcon,
    Badge,
    EmptyState,
    Icon,
    KeyboardHint,
    LauncherListRow,
    MetadataList,
    Modal,
    SearchableSelect,
    ShortcutCaptureOverlay,
    SplitListDetail,
    type SelectOption,
  } from '../../components';
  import AliasCapture from '../aliases/AliasCapture.svelte';
  import { aliasStore } from '../aliases/aliasStore.svelte';
  import { aliasService } from '../aliases/aliasService';
  import { shortcutStore, type ItemShortcut } from '../shortcuts/shortcutStore.svelte';
  import { shortcutService } from '../shortcuts/shortcutService';
  import { toDisplayString } from '../shortcuts/shortcutFormatter';
  import { toResolvedIcon } from '../../lib/icon';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { ALL_TAGS_VALUE, portalsUiState } from './index.svelte';
  import {
    deletePortal,
    openPortal,
    portalObjectId,
    syncAllPortalsToIndex,
  } from './portalLifecycle';
  import type { SearchResult } from '../../services/search/interfaces/SearchResult';
  import { tokenizePortalLink } from './portalPlaceholders';
  import { listApplications } from '../../lib/ipc/commands';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { searchBarAccessoryService } from '../../services/search/searchBarAccessoryService.svelte';
  import { ActionContext, type SearchBarAccessoryDropdownOption } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';

  let portals = $derived(portalsUiState.filteredPortals);
  let selectedIndex = $derived(portalsUiState.selectedIndex);
  let selectedPortal = $derived(
    selectedIndex >= 0 && selectedIndex < portals.length ? portals[selectedIndex] : null,
  );

  let openWithModalOpen = $state(false);
  let openWithTarget = $state<Portal | null>(null);
  let openWithChoice = $state('');
  let appOptions = $state<SelectOption[]>([]);

  let assignShortcutTarget = $state<SearchResult | null>(null);
  let assignAliasTarget = $state<{ objectId: string; name: string; currentAlias?: string } | null>(
    null,
  );

  const shortcutsByObjectId = $derived(
    new Map<string, ItemShortcut>(shortcutStore.shortcuts.map((s) => [s.objectId, s])),
  );

  onMount(async () => {
    void aliasStore.refresh().catch(() => {});
    try {
      const apps = await listApplications();
      appOptions = [...apps]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => ({ value: a.path, label: a.name, icon: a.icon }));
    } catch {
      appOptions = [];
    }
  });

  // Sync tag filter accessory in header (⌘P) without re-subscribing on tag change
  let lastTagListKey = '';
  $effect(() => {
    const tags = portalStore.getAllTags();
    const key = tags.join('\0');
    if (key === lastTagListKey) return;
    lastTagListKey = key;

    const options: SearchBarAccessoryDropdownOption[] = [
      { title: t('features.portals.ui.all_tags'), value: ALL_TAGS_VALUE },
      ...tags.map((tag) => ({ title: tag, value: tag })),
    ];
    const currentTag = untrack(() => portalsUiState.selectedTag);
    void searchBarAccessoryService.declare({
      extensionId: 'portals',
      commandId: 'open-portals',
      options,
      value: currentTag,
      buttonTitle: currentTag === ALL_TAGS_VALUE ? t('features.portals.ui.all_tags') : currentTag,
    });
  });

  onMount(() => {
    const unsub = searchBarAccessoryService.subscribe('portals', 'open-portals', (val) => {
      if (portalsUiState.selectedTag !== val) {
        portalsUiState.selectedTag = val;
        portalsUiState.selectedIndex = portalsUiState.filteredPortals.length > 0 ? 0 : -1;
      }
    });
    return () => {
      unsub();
      searchBarAccessoryService.clear();
    };
  });

  $effect(() => {
    if (portals.length === 0) {
      portalsUiState.selectedIndex = -1;
    } else if (selectedIndex < 0 || selectedIndex >= portals.length) {
      portalsUiState.selectedIndex = 0;
    }
  });

  $effect(() => {
    if (portals.length > 0) {
      actionService.unregisterAction('portals:create-empty');
      return;
    }
    actionService.registerAction({
      id: 'portals:create-empty',
      label: t('features.portals.ui.add_first'),
      icon: 'icon:plus',
      shortcut: 'Enter',
      primary: true,
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => startCreate(),
    });
    return () => {
      actionService.unregisterAction('portals:create-empty');
    };
  });

  $effect(() => {
    const portal = selectedPortal;
    const ids = [
      'portals:open',
      'portals:open-with',
      'portals:set-alias',
      'portals:remove-alias',
      'portals:set-shortcut',
      'portals:remove-shortcut',
      'portals:edit',
      'portals:duplicate',
      'portals:pin',
      'portals:copy-name',
      'portals:copy-link',
      'portals:toggle-hide',
      'portals:delete',
    ];
    if (!portal) {
      for (const id of ids) actionService.unregisterAction(id);
      return;
    }

    const objId = portalObjectId(portal.id);
    const currentAlias = aliasStore.byObjectId.get(objId);
    const currentShortcut = shortcutsByObjectId.get(objId);

    actionService.registerAction({
      id: 'portals:open',
      title: t('features.portals.act.open'),
      icon: 'icon:globe',
      shortcut: 'Enter',
      primary: true,
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await openPortal(portal);
      },
    });
    actionService.registerAction({
      id: 'portals:open-with',
      title: t('features.portals.act.open_with'),
      icon: 'icon:terminal',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        openWithTarget = portal;
        openWithChoice = portal.openWith ?? appOptions[0]?.value ?? '';
        openWithModalOpen = true;
      },
    });
    actionService.registerAction({
      id: 'portals:set-alias',
      label: currentAlias
        ? t('selection_actions.change_alias')
        : t('selection_actions.assign_alias'),
      icon: 'icon:tag',
      description: t('selection_actions.assign_alias_desc'),
      placement: 'manage',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        assignAliasTarget = { objectId: objId, name: portal.name, currentAlias };
      },
    });
    if (currentAlias) {
      actionService.registerAction({
        id: 'portals:remove-alias',
        title: t('features.portals.act.remove_alias'),
        icon: 'icon:trash',
        placement: 'manage',
        extensionId: 'portals',
        category: t('categories.portals'),
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await aliasService.unregister(currentAlias);
          aliasStore.removeOptimistic(currentAlias);
        },
      });
    } else {
      actionService.unregisterAction('portals:remove-alias');
    }
    actionService.registerAction({
      id: 'portals:set-shortcut',
      label: currentShortcut
        ? t('selection_actions.change_shortcut')
        : t('selection_actions.assign_shortcut'),
      icon: 'icon:keyboard',
      description: t('selection_actions.assign_shortcut_desc'),
      placement: 'manage',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        assignShortcutTarget = {
          objectId: objId,
          name: portal.name,
          type: 'command',
          score: 1,
          tier: 1,
          icon: toResolvedIcon(portal.icon),
        };
      },
    });
    if (currentShortcut) {
      actionService.registerAction({
        id: 'portals:remove-shortcut',
        title: t('features.portals.act.remove_shortcut'),
        icon: 'icon:trash',
        placement: 'manage',
        extensionId: 'portals',
        category: t('categories.portals'),
        context: ActionContext.EXTENSION_VIEW,
        execute: async () => {
          await shortcutService.unregister(objId);
        },
      });
    } else {
      actionService.unregisterAction('portals:remove-shortcut');
    }
    actionService.registerAction({
      id: 'portals:edit',
      title: t('features.portals.action_edit'),
      icon: 'icon:pencil',
      shortcut: 'Mod+E',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        startEdit(portal);
      },
    });
    actionService.registerAction({
      id: 'portals:duplicate',
      title: t('features.portals.action_duplicate'),
      icon: 'icon:copy',
      shortcut: 'Mod+D',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await handleDuplicate(portal);
      },
    });
    actionService.registerAction({
      id: 'portals:pin',
      title: portal.pinned ? t('features.portals.act.unpin') : t('features.portals.act.pin'),
      icon: 'icon:pin',
      shortcut: 'Mod+Shift+P',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        portalStore.togglePin(portal.id);
      },
    });
    actionService.registerAction({
      id: 'portals:copy-name',
      title: t('features.portals.act.copy_name'),
      icon: 'icon:copy',
      shortcut: 'Mod+Shift+C',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await writeClipboardText(portal.name);
      },
    });
    actionService.registerAction({
      id: 'portals:copy-link',
      title: t('features.portals.act.copy_link'),
      icon: 'icon:link',
      shortcut: 'Mod+Shift+L',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await writeClipboardText(portal.url);
      },
    });
    actionService.registerAction({
      id: 'portals:toggle-hide',
      title: portal.hiddenInRootSearch
        ? t('features.portals.act.show_root')
        : t('features.portals.act.hide_root'),
      icon: 'icon:eye',
      extensionId: 'portals',
      category: t('categories.portals'),
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        portalStore.toggleHiddenInRootSearch(portal.id);
        await syncAllPortalsToIndex();
      },
    });
    actionService.registerAction({
      id: 'portals:delete',
      label: t('features.portals.action_delete'),
      icon: 'icon:trash',
      shortcut: 'Control+X',
      extensionId: 'portals',
      category: t('categories.portals'),
      destructive: true,
      confirmInExecute: true,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => {
        await handleDelete(portal);
      },
    });

    return () => {
      for (const id of ids) actionService.unregisterAction(id);
    };
  });

  const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  function formatOpenWithLabel(openWith?: string): string | undefined {
    if (!openWith) return undefined;
    const match = appOptions.find((a) => a.value === openWith);
    if (match) return match.label;
    return (
      openWith
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.app$/i, '') ?? openWith
    );
  }

  function startCreate() {
    portalsUiState.startCreate();
    viewManager.navigateToView('portals/PortalFormView', { searchable: false });
  }

  function startEdit(portal: Portal) {
    portalsUiState.startEdit(portal);
    viewManager.navigateToView('portals/PortalFormView', { searchable: false });
  }

  async function handleDelete(portal: Portal) {
    const confirmed = await feedbackService.confirmAlert({
      title: t('features.portals.delete_confirm_title'),
      message: t('features.portals.ui.delete_confirm', { name: portal.name }),
      confirmText: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deletePortal(portal.id);
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('features.portals.ui.remove_failed', { error: String(err) }) },
      });
    }
  }

  async function handleDuplicate(portal: Portal) {
    const dup: Portal = {
      ...portal,
      id: crypto.randomUUID(),
      name: `${portal.name} Copy`,
      openCount: 0,
      createdAt: Date.now(),
      updatedAt: undefined,
    };
    portalStore.add(dup);
    try {
      await syncAllPortalsToIndex();
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'warning',
        retryable: false,
        context: { message: t('features.portals.ui.index_failed', { error: String(err) }) },
      });
    }
    await tick();
    const idx = portalsUiState.filteredPortals.findIndex((p) => p.id === dup.id);
    if (idx >= 0) portalsUiState.selectedIndex = idx;
  }

  async function confirmOpenWith() {
    const target = openWithTarget;
    const app = openWithChoice;
    openWithModalOpen = false;
    openWithTarget = null;
    if (target) {
      await openPortal(target, undefined, app || undefined);
    }
  }
</script>

<div class="view-container">
  <SplitListDetail
    items={portals}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={500}
    ariaLabel="Portals"
    emptyMessage={t('features.portals.no_portals')}
  >
    {#snippet listItem(portal, index)}
      {@const objId = portalObjectId(portal.id)}
      {@const rowAlias = aliasStore.byObjectId.get(objId)}
      {@const rowShortcut = shortcutsByObjectId.get(objId)}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        title={portal.name}
        onclick={() => (portalsUiState.selectedIndex = index)}
        ondblclick={() => void openPortal(portal)}
      >
        {#snippet leading()}
          <AppIcon icon={portal.icon} size={18} glyphSize={15} />
        {/snippet}
        {#snippet trailing()}
          <div class="row-trailing-icons">
            {#if rowAlias}
              <Badge text={rowAlias} variant="default" mono />
            {/if}
            {#if rowShortcut}
              <KeyboardHint keys={toDisplayString(rowShortcut.shortcut)} />
            {/if}
            {#if portal.hiddenInRootSearch}
              <span class="row-status-icon" title="Hidden in Root Search">
                <Icon name="eye" size={13} />
              </span>
            {/if}
            {#if portal.pinned}
              <span class="row-status-icon" title="Pinned">
                <Icon name="pin" size={13} />
              </span>
            {/if}
          </div>
        {/snippet}
      </LauncherListRow>
    {/snippet}

    {#snippet detail()}
      {#if selectedPortal}
        {@const segments = tokenizePortalLink(selectedPortal.url)}
        {@const openWithLabel = formatOpenWithLabel(selectedPortal.openWith)}
        {@const openCount = selectedPortal.openCount ?? 0}
        {@const selectedObjId = portalObjectId(selectedPortal.id)}
        {@const selectedAlias = aliasStore.byObjectId.get(selectedObjId)}
        {@const selectedShortcut = shortcutsByObjectId.get(selectedObjId)}
        <div class="portal-detail-content custom-scrollbar">
          <p class="portal-url-preview">
            {#each segments as seg}
              {#if seg.isArgument}
                <span class="preview-arg-slot">_</span>
              {:else if seg.isPlaceholder}
                <span class="preview-placeholder">{seg.text}</span>
              {:else}
                {seg.text}
              {/if}
            {/each}
          </p>
        </div>
        <MetadataList
          title={t('common.information')}
          items={[
            {
              label: t('common.name'),
              value: selectedPortal.name,
            },
            {
              label: 'Link',
              value: selectedPortal.url,
              title: selectedPortal.url,
            },
            ...(openWithLabel ? [{ label: 'Open With', value: openWithLabel }] : []),
            ...(selectedPortal.tags && selectedPortal.tags.length > 0
              ? [{ label: 'Tags', value: selectedPortal.tags.join(', ') }]
              : []),
            ...(selectedAlias
              ? [{ label: t('features.portals.ui.alias'), value: selectedAlias }]
              : []),
            ...(selectedShortcut
              ? [
                  {
                    label: t('features.portals.ui.hotkey'),
                    value: toDisplayString(selectedShortcut.shortcut),
                  },
                ]
              : []),
            {
              label: t('features.portals.ui.created'),
              value: dateTimeFormat.format(selectedPortal.createdAt),
            },
            ...(selectedPortal.updatedAt
              ? [
                  {
                    label: 'Last Updated',
                    value: dateTimeFormat.format(selectedPortal.updatedAt),
                  },
                ]
              : []),
            {
              label: 'Opened',
              value: `${openCount} ${openCount === 1 ? 'time' : 'times'}`,
            },
          ]}
        />
      {:else}
        <EmptyState
          message={portals.length === 0
            ? t('features.portals.no_portals')
            : t('features.portals.select_portal')}
          description={portals.length === 0
            ? t('features.portals.no_portals_description')
            : t('features.portals.select_portal_description')}
        >
          {#snippet icon()}
            <Icon name="link" size={48} />
          {/snippet}
          {#if portals.length === 0}
            <button class="btn-primary mt-4" onclick={startCreate}>
              {t('features.portals.ui.add_first')}
            </button>
          {/if}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

{#if openWithModalOpen && openWithTarget}
  <Modal
    bind:isOpen={openWithModalOpen}
    title={t('features.portals.ui.open_with_title')}
    onEscape={() => (openWithModalOpen = false)}
  >
    <div class="open-with-modal-body">
      <SearchableSelect
        bind:value={openWithChoice}
        options={appOptions}
        placeholder={t('features.portals.ui.choose_application')}
        filterPlaceholder={t('features.portals.ui.search_applications')}
      />
      <div class="open-with-modal-actions">
        <button type="button" class="btn-secondary" onclick={() => (openWithModalOpen = false)}>
          {t('common.cancel')}
        </button>
        <button type="button" class="btn-primary" onclick={confirmOpenWith}>
          {t('features.portals.ui.open_portal_btn')}
        </button>
      </div>
    </div>
  </Modal>
{/if}

{#if assignShortcutTarget}
  <ShortcutCaptureOverlay
    target={assignShortcutTarget}
    oncapture={() => {
      assignShortcutTarget = null;
    }}
    oncancel={() => {
      assignShortcutTarget = null;
    }}
  />
{/if}

{#if assignAliasTarget}
  <AliasCapture
    objectId={assignAliasTarget.objectId}
    itemName={assignAliasTarget.name}
    itemType="command"
    currentAlias={assignAliasTarget.currentAlias}
    onsave={() => {
      assignAliasTarget = null;
    }}
    oncancel={() => {
      assignAliasTarget = null;
    }}
  />
{/if}

<style>
  .portal-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .portal-url-preview {
    font-family: var(--font-ui);
    font-size: var(--font-size-md);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-all;
    margin: 0;
  }
  .preview-arg-slot {
    color: var(--accent-success);
    font-weight: 600;
  }
  .preview-placeholder {
    color: var(--accent-primary);
  }
  .row-trailing-icons {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-tertiary);
  }
  .row-status-icon {
    display: inline-flex;
    align-items: center;
  }
  .open-with-modal-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: calc(var(--size-3xl) * 5);
  }
  .open-with-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
