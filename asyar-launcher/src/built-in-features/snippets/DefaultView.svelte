<script lang="ts">
  import { onMount } from 'svelte';
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetService, enabledPersistence } from './snippetService';
  import { snippetUiState } from './snippetUiState.svelte';
  import { snippetViewState } from './snippetViewState.svelte';
  import {
    SplitListDetail, ListItem, ListItemActions, Badge,
    ActionFooter, EmptyState, ConfirmDialog, WarningBanner, FormField
  } from '../../components';

  let permissionGranted = $state(true);
  let prefillExpansion = $state<string | null>(null);

  // Confirm dialog state (driven by snippetViewState.pendingDeleteId)
  let confirmOpen = $state(false);
  let pendingDeleteName = $state<string | null>(null);

  // Watch clipboard-history integration trigger
  $effect(() => {
    if (snippetUiState.editorTrigger === 'add') {
      prefillExpansion = snippetUiState.prefillExpansion;
      snippetUiState.editorTrigger = null;
      snippetUiState.prefillExpansion = null;
      snippetViewState.startCreate();
    }
  });

  // Watch pendingDeleteId from state (set by keyboard Cmd+Backspace in index.ts)
  $effect(() => {
    if (snippetViewState.pendingDeleteId) {
      const s = snippetStore.snippets.find(s => s.id === snippetViewState.pendingDeleteId);
      pendingDeleteName = s?.name ?? null;
      confirmOpen = true;
    }
  });

  // Inline form state
  let formName = $state('');
  let formKeyword = $state('');
  let formExpansion = $state('');
  let formError = $state<string | null>(null);
  let formId = $state('');

  // Sync form fields when mode or editingSnippet changes
  $effect(() => {
    if (snippetViewState.mode === 'create') {
      formName = '';
      formKeyword = '';
      formExpansion = prefillExpansion ?? '';
      formError = null;
      formId = crypto.randomUUID();
    } else if (snippetViewState.mode === 'edit' && snippetViewState.editingSnippet) {
      const s = snippetViewState.editingSnippet;
      formName = s.name;
      formKeyword = s.keyword;
      formExpansion = s.expansion;
      formError = null;
      formId = s.id;
    }
  });

  let filteredSnippets = $derived(snippetViewState.getFilteredSnippets());
  let selectedIndex = $derived(snippetViewState.selectedIndex);
  let selectedSnippet = $derived(snippetViewState.selectedSnippet);

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });

  onMount(async () => {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    const currentEnabled = enabledPersistence.loadSync(true);
    await snippetService.setEnabled(currentEnabled && permissionGranted);
  });

  async function handleSave() {
    if (!formName.trim()) { formError = 'Name is required.'; return; }
    if (!formKeyword.trim()) { formError = 'Keyword is required.'; return; }
    if (!formExpansion.trim()) { formError = 'Expansion is required.'; return; }
    if (/[A-Z]/.test(formKeyword)) { formError = 'Keyword must be lowercase.'; return; }
    const isDuplicate = snippetStore.getAll().some(s => s.keyword === formKeyword.trim() && s.id !== formId);
    if (isDuplicate) { formError = 'Keyword is already in use.'; return; }

    const payload: Snippet = {
      id: formId,
      name: formName.trim(),
      keyword: formKeyword.trim().toLowerCase(),
      expansion: formExpansion,
      createdAt: snippetViewState.editingSnippet?.createdAt ?? Date.now(),
    };

    if (snippetViewState.mode === 'edit') {
      snippetStore.update(formId, payload);
    } else {
      snippetStore.add(payload);
      // Select new snippet
      const idx = snippetViewState.getFilteredSnippets().findIndex(s => s.id === formId);
      if (idx >= 0) snippetViewState.selectItem(idx);
    }
    await snippetService.syncToRust();
    prefillExpansion = null;
    snippetViewState.cancelEdit();
  }

  function handleFormKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); snippetViewState.cancelEdit(); prefillExpansion = null; }
  }

  function handleDeleteRequest(snippet: Snippet) {
    snippetViewState.pendingDeleteId = snippet.id;
    pendingDeleteName = snippet.name;
    confirmOpen = true;
  }

  async function handleConfirmDelete() {
    if (!snippetViewState.pendingDeleteId) return;
    snippetStore.remove(snippetViewState.pendingDeleteId);
    await snippetService.syncToRust();
    snippetViewState.pendingDeleteId = null;
    pendingDeleteName = null;
    confirmOpen = false;
  }

  async function recheckPermission() {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    const currentEnabled = enabledPersistence.loadSync(true);
    if (permissionGranted && currentEnabled) await snippetService.setEnabled(true);
  }

  function duplicateSnippet(snippet: Snippet) {
    const newId = crypto.randomUUID();
    // Make keyword unique: append -copy, then -copy2, -copy3, etc.
    let newKeyword = snippet.keyword + '-copy';
    const existing = snippetStore.getAll().map(s => s.keyword);
    let i = 2;
    while (existing.includes(newKeyword)) {
      newKeyword = snippet.keyword + `-copy${i}`;
      i++;
    }
    return {
      id: newId,
      name: snippet.name + ' Copy',
      keyword: newKeyword,
      expansion: snippet.expansion,
      createdAt: Date.now(),
    };
  }

  async function handleDuplicate(snippet: Snippet) {
    const dup = duplicateSnippet(snippet);
    snippetStore.add(dup);
    await snippetService.syncToRust();
    const idx = snippetViewState.getFilteredSnippets().findIndex(s => s.id === dup.id);
    if (idx >= 0) snippetViewState.selectItem(idx);
  }
</script>

<svelte:window onkeydown={handleFormKeydown} />

<div class="view-container">
  {#if !permissionGranted}
    <div class="permission-banner-wrapper">
      <WarningBanner>
        {#snippet children()}
          <p>Background expansion requires Accessibility permission. Open System Settings → Privacy & Security → Accessibility and add Asyar. If running in development, add the binary at: src-tauri/target/debug/asyar</p>
        {/snippet}
        {#snippet actions()}
          <button class="btn-secondary" onclick={() => snippetService.openAccessibilityPreferences()}>Open System Settings</button>
          <button class="btn-secondary" onclick={recheckPermission}>Re-check Permission</button>
        {/snippet}
      </WarningBanner>
    </div>
  {/if}

  <SplitListDetail
    items={filteredSnippets}
    {selectedIndex}
    leftWidth={260}
    minLeftWidth={200}
    maxLeftWidth={500}
    ariaLabel="Snippets"
    emptyMessage="No snippets found"
  >
    {#snippet listItem(snippet, index)}
      <ListItem
        data-index={index}
        selected={selectedIndex === index}
        title={snippet.name}
        onclick={() => snippetViewState.selectItem(index)}
      >
        {#snippet leading()}
          <div class="leading-icon">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          </div>
        {/snippet}
        {#snippet subtitle()}
          <div class="flex items-center gap-2">
            <Badge text={snippet.keyword} variant="default" mono />
            <span class="expansion-preview">{snippet.expansion}</span>
          </div>
        {/snippet}
        {#snippet trailing()}
          <ListItemActions>
            <button
              class="action-btn action-btn-danger"
              onclick={(e) => { e.stopPropagation(); handleDeleteRequest(snippet); }}
              title="Delete snippet"
            >✕</button>
          </ListItemActions>
        {/snippet}
      </ListItem>
    {/snippet}

    {#snippet detail()}
      {#if snippetViewState.mode === 'edit' || snippetViewState.mode === 'create'}
        <!-- Inline form — no modal -->
        <div class="form-panel">
          <div class="form-header">
            <h2 class="form-title">{snippetViewState.mode === 'edit' ? 'Edit Snippet' : 'New Snippet'}</h2>
          </div>
          <div class="form-body custom-scrollbar">
            <FormField label="Name" id="form-name">
              <input id="form-name" class="field-input" type="text" bind:value={formName} placeholder="e.g. My Email" />
            </FormField>
            <FormField label="Keyword" id="form-keyword" hint="Use a prefix like ; or /. Lowercase letters and symbols only.">
              <input id="form-keyword" class="field-input" type="text" bind:value={formKeyword} placeholder="e.g. ;email" />
            </FormField>
            <FormField label="Expansion" id="form-expansion">
              <textarea id="form-expansion" class="field-textarea" bind:value={formExpansion} placeholder="e.g. hello@example.com" rows="5"></textarea>
            </FormField>
            {#if formError}
              <div class="form-error">{formError}</div>
            {/if}
          </div>
          <div class="form-footer">
            <button class="btn-secondary" onclick={() => { snippetViewState.cancelEdit(); prefillExpansion = null; }}>Cancel</button>
            <button class="btn-primary" onclick={handleSave}>Save</button>
          </div>
        </div>

      {:else if selectedSnippet}
        <!-- Detail view -->
        <div class="snippet-detail-content custom-scrollbar">
          <div class="detail-header">
            <h2 class="snippet-name">{selectedSnippet.name}</h2>
            <div class="flex items-center gap-2">
              <button class="btn-secondary edit-btn" onclick={() => handleDuplicate(selectedSnippet)}>Duplicate</button>
              <button class="btn-secondary edit-btn" onclick={() => snippetViewState.startEdit(selectedSnippet)}>Edit</button>
            </div>
          </div>
          <div class="keyword-row">
            <Badge text={selectedSnippet.keyword} variant="default" mono />
          </div>
          <pre class="snippet-expansion">{selectedSnippet.expansion}</pre>
        </div>
        <ActionFooter>
          {#snippet left()}
            <div class="flex items-center gap-3">
              <Badge text="snippet" variant="default" mono />
              <span class="flex items-center gap-1 text-caption">
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                {dateFormat.format(selectedSnippet.createdAt)}
              </span>
              <span class="text-caption" style="color: var(--text-tertiary)">{selectedSnippet.expansion.length} chars</span>
            </div>
          {/snippet}
        </ActionFooter>

      {:else}
        <!-- Nothing selected -->
        <EmptyState
          message={filteredSnippets.length === 0 ? 'No snippets yet' : 'Select a snippet'}
          description={filteredSnippets.length === 0 ? 'Create your first snippet to expand text automatically.' : 'Choose a snippet from the list to view its details.'}
        >
          {#snippet icon()}
            <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
            </svg>
          {/snippet}
          {#if filteredSnippets.length === 0}
            <button class="btn-primary mt-4" onclick={() => snippetViewState.startCreate()}>Add your first snippet</button>
          {/if}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>

  <ConfirmDialog
    bind:isOpen={confirmOpen}
    title="Delete snippet"
    message={`Delete "${pendingDeleteName}"? This cannot be undone.`}
    confirmButtonText="Delete"
    variant="danger"
    onconfirm={handleConfirmDelete}
    oncancel={() => {
      snippetViewState.pendingDeleteId = null;
      pendingDeleteName = null;
      confirmOpen = false;
    }}
  />
</div>

<style>
  .permission-banner-wrapper { margin: 12px 16px 0; }
  .leading-icon { opacity: 0.6; display: flex; align-items: center; justify-content: center; margin-right: 4px; }
  .expansion-preview { font-size: var(--font-size-xs); color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
  .action-btn { display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-tertiary); cursor: pointer; font-size: 12px; }
  .action-btn:hover { color: var(--text-primary); background: var(--bg-secondary); }
  .action-btn-danger:hover { color: var(--accent-danger); }

  /* Detail view */
  .snippet-detail-content { flex: 1; overflow-y: auto; padding: 24px 32px; display: flex; flex-direction: column; gap: 16px; }
  .detail-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .snippet-name { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0; }
  .keyword-row { display: flex; align-items: center; gap: 8px; }
  .snippet-expansion { font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: var(--text-primary); white-space: pre-wrap; word-break: break-word; background: var(--bg-secondary); border-radius: var(--radius-sm); padding: 16px; margin: 0; }
  .edit-btn { font-size: var(--font-size-xs); padding: 4px 10px; flex-shrink: 0; }

  /* Inline form */
  .form-panel { display: flex; flex-direction: column; height: 100%; }
  .form-header { padding: 20px 24px 0; flex-shrink: 0; }
  .form-title { font-size: var(--font-size-lg); font-weight: 600; color: var(--text-primary); margin: 0 0 16px; }
  .form-body { flex: 1; overflow-y: auto; padding: 0 24px; display: flex; flex-direction: column; gap: 16px; padding-bottom: 16px; }
  .form-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 24px; border-top: 1px solid var(--separator); flex-shrink: 0; }
  .form-error { font-size: var(--font-size-sm); padding: 8px 10px; border-radius: var(--radius-sm); color: var(--accent-danger); background: color-mix(in srgb, var(--accent-danger) 10%, transparent); }
  .field-input { width: 100%; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); font-size: var(--font-size-sm); }
  .field-textarea { width: 100%; padding: 8px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary); font-size: var(--font-size-sm); font-family: var(--font-mono); resize: vertical; line-height: 1.5; }
  .field-input:focus, .field-textarea:focus { outline: 2px solid var(--accent-primary); outline-offset: -1px; }
</style>
