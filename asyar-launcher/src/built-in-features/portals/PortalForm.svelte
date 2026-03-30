<script lang="ts">
  import type { Portal } from './portalStore.svelte';

  let { 
    portal = {}, 
    isEditing = false, 
    onsave, 
    oncancel 
  }: { 
    portal?: Partial<Portal>; 
    isEditing?: boolean; 
    onsave?: (portal: Portal) => void; 
    oncancel?: () => void 
  } = $props();

  let name = $state('');
  let url  = $state('');
  let icon = $state('🌐');

  $effect(() => {
    name = portal.name ?? '';
    url  = portal.url  ?? '';
    icon = portal.icon ?? '🌐';
  });

  function handleSave() {
    if (!name.trim() || !url.trim()) return;
    onsave?.({
      id:        portal.id ?? crypto.randomUUID(),
      name:      name.trim(),
      url:       url.trim(),
      icon:      icon.trim() || '🌐',
      createdAt: portal.createdAt ?? Date.now(),
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { e.preventDefault(); oncancel?.(); }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="portal-form p-4">
  <div class="flex flex-col gap-1">
    <label for="portal-name" class="text-label">Name</label>
    <input id="portal-name" class="field-input" type="text" bind:value={name} placeholder="Search Google" autofocus />
  </div>
  <div class="flex flex-col gap-1">
    <label for="portal-url" class="text-label">URL</label>
    <input id="portal-url" class="field-input" type="text" bind:value={url} placeholder="https://google.com/search?q={'{query}'}" />
  </div>
  <div class="flex flex-col gap-1">
    <label for="portal-icon" class="text-label">Icon</label>
    <input id="portal-icon" class="field-input" type="text" bind:value={icon} placeholder="🌐" maxlength="4" />
  </div>
  <p class="text-caption">Use <code class="text-mono code-inline">{'{query}'}</code> in the URL — it fills with your search text when you run the portal.</p>
  <div class="flex justify-end gap-2 pt-1">
    <button class="btn-secondary" onclick={() => oncancel?.()}>Cancel</button>
    <button class="btn-primary" onclick={handleSave} disabled={!name.trim() || !url.trim()}>
      {isEditing ? 'Update' : 'Save'} <span class="shortcut-hint">⌘S</span>
    </button>
  </div>
</div>

<style>
  .portal-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
  .code-inline {
    background: var(--bg-hover);
    padding: 1px 4px;
    border-radius: var(--radius-xs);
  }
  .shortcut-hint {
    opacity: 0.7;
    font-size: 11px;
    margin-left: 6px;
    font-weight: 500;
  }
</style>
