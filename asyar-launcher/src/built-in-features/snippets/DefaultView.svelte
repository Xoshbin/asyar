<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetService, enabledPersistence } from './snippetService';
  import { snippetUiState } from './snippetUiState.svelte';
  import SnippetEditor from './SnippetEditor.svelte';
  import { EmptyState, ListItem, Badge, ListItemActions, ConfirmDialog, WarningBanner } from '../../components';

  let permissionGranted = $state(true);
  let editingItem = $state<Snippet | null | undefined>(null); // null means not editing, undefined means creating
  let currentPrefill = $state<string | null>(null);

  let confirmOpen = $state(false);
  let pendingDeleteId = $state<string | null>(null);
  let pendingDeleteName = $state<string | null>(null);

  $effect(() => {
    if (snippetUiState.editorTrigger === 'add') {
      editingItem = undefined;
      currentPrefill = snippetUiState.prefillExpansion;   // capture
      snippetUiState.editorTrigger = null;
      snippetUiState.prefillExpansion = null;              // clear
    }
  });

  onMount(async () => {
    // Attempt to sync / get permission on view open
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    
    // Make sure initial state matches rust backend
    const currentEnabled = enabledPersistence.loadSync(true);
    await snippetService.setEnabled(currentEnabled && permissionGranted);
  });

  function handleRemove(id: string, name: string) {
    pendingDeleteId = id;
    pendingDeleteName = name;
    confirmOpen = true;
  }

  async function handleConfirmDelete() {
    if (!pendingDeleteId) return;
    snippetStore.remove(pendingDeleteId);
    await snippetService.syncToRust();
    pendingDeleteId = null;
    pendingDeleteName = null;
  }


  async function recheckPermission() {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    const currentEnabled = enabledPersistence.loadSync(true);
    if (permissionGranted && currentEnabled) {
      await snippetService.setEnabled(true);
    }
  }

</script>

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

  <div class="list custom-scrollbar">
    {#if snippetStore.snippets.length === 0}
      <EmptyState 
        message="No snippets yet" 
        description="Create your first snippet to expand text automatically."
      >
        {#snippet icon()}
          <span class="text-4xl opacity-50">✂️</span>
        {/snippet}
        <button class="btn-primary mt-4" onclick={() => editingItem = undefined}>Add your first snippet</button>
      </EmptyState>
    {:else}
      {#each snippetStore.snippets as s (s.id)}
        <ListItem 
          title={s.name}
          onclick={() => editingItem = s}
        >
          {#snippet subtitle()}
            <div class="flex items-center gap-2">
              <Badge text={s.keyword} variant="default" mono />
              <span class="text-caption truncate max-w-[300px] opacity-60">{s.expansion}</span>
            </div>
          {/snippet}
          {#snippet trailing()}
            <ListItemActions>
              <button class="btn-secondary edit-btn" onclick={(e) => { e.stopPropagation(); editingItem = s; }} title="Edit snippet">
                Edit
              </button>
              <button class="btn-danger h-7 w-7 flex items-center justify-center p-0" onclick={(e) => { e.stopPropagation(); handleRemove(s.id, s.name); }} title="Delete snippet">✕</button>
            </ListItemActions>
          {/snippet}
        </ListItem>
      {/each}
    {/if}
  </div>

  <ConfirmDialog
    bind:isOpen={confirmOpen}
    title="Delete snippet"
    message={`Delete "${pendingDeleteName}"? This cannot be undone.`}
    confirmButtonText="Delete"
    variant="danger"
    onconfirm={handleConfirmDelete}
    oncancel={() => { pendingDeleteId = null; pendingDeleteName = null; }}
  />

  {#if editingItem !== null}
    <SnippetEditor 
      snippet={editingItem} 
      prefillExpansion={currentPrefill ?? undefined}
      onclose={() => { editingItem = null; currentPrefill = null; }} 
    />
  {/if}
</div>

<style>

  .permission-banner-wrapper {
    margin: 12px 16px 0;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
    min-height: 0;
  }

  .edit-btn {
    font-size: var(--font-size-xs);
    padding: 4px 10px;
  }


</style>

