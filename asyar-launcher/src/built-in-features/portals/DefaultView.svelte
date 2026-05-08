<script lang="ts">
  import { tick } from 'svelte';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { syncPortalToIndex, removePortalFromIndex, portalsUiState } from './index.svelte';
  import { parseUrlPlaceholders } from '../../lib/placeholders';
  import PortalForm from './PortalForm.svelte';
  import {
    SplitListDetail, LauncherListRow, IconBox, Badge,
    ActionFooter, EmptyState,
  } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { diagnosticsService } from '../../services/diagnostics/diagnosticsService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';

  type Mode = 'view' | 'create' | 'edit';
  let mode = $state<Mode>('view');
  let editingPortal = $state<Portal | null>(null);

  $effect(() => {
    if (portalsUiState.openMode === 'new') {
      mode = 'create';
      editingPortal = null;
      portalsUiState.openMode = 'list';
    }
  });

  let portals = $derived(portalStore.portals);
  let selectedIndex = $derived(portalsUiState.selectedIndex);
  let selectedPortal = $derived(
    selectedIndex >= 0 && selectedIndex < portals.length ? portals[selectedIndex] : null
  );

  $effect(() => {
    if (portals.length === 0) {
      portalsUiState.selectedIndex = -1;
    } else if (selectedIndex < 0 || selectedIndex >= portals.length) {
      portalsUiState.selectedIndex = 0;
    }
  });

  $effect(() => {
    const portal = selectedPortal;
    if (!portal || mode !== 'view') {
      actionService.unregisterAction('portals:edit');
      actionService.unregisterAction('portals:duplicate');
      actionService.unregisterAction('portals:delete');
      return;
    }
    actionService.registerAction({
      id: 'portals:edit',
      title: 'Edit',
      icon: 'icon:pencil',
      extensionId: 'portals',
      category: 'Portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => { startEdit(portal); },
    });
    actionService.registerAction({
      id: 'portals:duplicate',
      title: 'Duplicate',
      icon: 'icon:copy',
      extensionId: 'portals',
      category: 'Portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => { await handleDuplicate(portal); },
    });
    actionService.registerAction({
      id: 'portals:delete',
      title: 'Delete',
      icon: 'icon:trash',
      extensionId: 'portals',
      category: 'Portals',
      destructive: true,
      context: ActionContext.EXTENSION_VIEW,
      execute: async () => { await handleDelete(portal); },
    });
    return () => {
      actionService.unregisterAction('portals:edit');
      actionService.unregisterAction('portals:duplicate');
      actionService.unregisterAction('portals:delete');
    };
  });

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  function startCreate() {
    editingPortal = null;
    mode = 'create';
  }

  function startEdit(portal: Portal) {
    editingPortal = portal;
    mode = 'edit';
  }

  function cancelEdit() {
    mode = 'view';
    editingPortal = null;
  }

  async function handleSave(portal: Portal) {
    try {
      if (mode === 'edit' && editingPortal) {
        const editingId = editingPortal.id;
        portalStore.update(editingId, portal);
        await removePortalFromIndex(editingId);
        await syncPortalToIndex({ ...portal, id: editingId });
      } else {
        portalStore.add(portal);
        await syncPortalToIndex(portal);
        const idx = portalStore.portals.findIndex(p => p.id === portal.id);
        if (idx >= 0) portalsUiState.selectedIndex = idx;
      }
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'error',
        retryable: false,
        context: { message: `Could not save portal: ${err}` },
      });
    } finally {
      cancelEdit();
    }
  }

  async function handleDelete(portal: Portal) {
    const confirmed = await feedbackService.confirmAlert({
      title: 'Delete portal',
      message: `Delete "${portal.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    portalStore.remove(portal.id);
    try {
      await removePortalFromIndex(portal.id);
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'warning',
        retryable: false,
        context: { message: `Could not remove portal from search index: ${err}` },
      });
    }
  }

  async function handleDuplicate(portal: Portal) {
    const dup: Portal = {
      ...portal,
      id: crypto.randomUUID(),
      name: portal.name + ' Copy',
      createdAt: Date.now(),
    };
    portalStore.add(dup);
    try {
      await syncPortalToIndex(dup);
    } catch (err) {
      diagnosticsService.report({
        source: 'frontend', kind: 'manual', severity: 'warning',
        retryable: false,
        context: { message: `Could not index duplicated portal: ${err}` },
      });
    }
    await tick();
    const idx = portalStore.portals.findIndex(p => p.id === dup.id);
    if (idx >= 0) portalsUiState.selectedIndex = idx;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (mode !== 'view') return;
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      startCreate();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="view-container">
  <SplitListDetail
    items={portals}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={500}
    ariaLabel="Portals"
    emptyMessage="No portals yet"
  >
    {#snippet listItem(portal, index)}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        title={portal.name}
        subtitle={portal.url}
        onclick={() => (portalsUiState.selectedIndex = index)}
      >
        {#snippet leading()}
          <IconBox size="md">
            {#snippet content()}
              {portal.icon}
            {/snippet}
          </IconBox>
        {/snippet}
      </LauncherListRow>
    {/snippet}

    {#snippet detail()}
      {#if mode === 'create' || mode === 'edit'}
        <div class="form-panel">
          <div class="form-header">
            <h2 class="form-title">{mode === 'edit' ? 'Edit Portal' : 'New Portal'}</h2>
          </div>
          <div class="form-body custom-scrollbar">
            <PortalForm
              portal={editingPortal ?? undefined}
              isEditing={mode === 'edit'}
              onsave={handleSave}
              oncancel={cancelEdit}
            />
          </div>
        </div>
      {:else if selectedPortal}
        {@const tokens = parseUrlPlaceholders(selectedPortal.url)}
        <div class="portal-detail-content custom-scrollbar">
          <div class="detail-header">
            <div class="detail-title-row">
              <IconBox size="lg">
                {#snippet content()}
                  {selectedPortal.icon}
                {/snippet}
              </IconBox>
              <h2 class="portal-name">{selectedPortal.name}</h2>
            </div>
          </div>

          <div class="field-group">
            <div class="field-label">URL</div>
            <pre class="portal-url">{selectedPortal.url}</pre>
          </div>

          {#if tokens.length > 0}
            <div class="field-group">
              <div class="field-label">Placeholders</div>
              <div class="placeholder-row">
                {#each tokens as token}
                  <Badge text={token} variant="default" mono />
                {/each}
              </div>
            </div>
          {/if}
        </div>
        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center gap-3">
              <Badge text="portal" variant="default" mono />
              <span class="text-caption">
                {dateFormat.format(selectedPortal.createdAt)}
              </span>
              <span class="text-caption portal-meta-dim">
                {tokens.length} placeholder{tokens.length === 1 ? '' : 's'}
              </span>
            </div>
          {/snippet}
        </ActionFooter>
      {:else}
        <EmptyState
          message={portals.length === 0 ? 'No portals yet' : 'Select a portal'}
          description={portals.length === 0 ? 'Add a URL shortcut to get started.' : 'Choose a portal from the list to view its details.'}
        >
          {#snippet icon()}
            <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          {/snippet}
          {#if portals.length === 0}
            <button class="btn-primary mt-4" onclick={startCreate}>Add your first portal</button>
          {/if}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

<style>
  .portal-detail-content { flex: 1; overflow-y: auto; padding: var(--space-6); display: flex; flex-direction: column; gap: var(--space-6); }
  .detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-5); }
  .detail-title-row { display: flex; align-items: center; gap: var(--space-3); }
  .portal-name { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0; }
  .portal-meta-dim { color: var(--text-tertiary); }

  .field-group { display: flex; flex-direction: column; gap: var(--space-2); }
  .field-label { font-size: var(--font-size-xs); color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.05em; }
  .portal-url { font-family: var(--font-mono); font-size: var(--font-size-md); line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-break: break-all; background: var(--bg-secondary); border-radius: var(--radius-sm); padding: var(--space-4) var(--space-5); margin: 0; }
  .placeholder-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }

  .form-panel { display: flex; flex-direction: column; height: 100%; }
  .form-header { padding: var(--space-7) var(--space-8) 0; flex-shrink: 0; }
  .form-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0 0 var(--space-6); }
  .form-body { flex: 1; overflow-y: auto; padding: 0 var(--space-8) var(--space-6); }
</style>
