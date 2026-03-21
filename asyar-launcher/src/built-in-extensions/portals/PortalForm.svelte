<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Portal } from './portalStore';

  export let portal: Partial<Portal> = {};
  export let isEditing = false;

  const dispatch = createEventDispatcher<{
    save: Portal;
    cancel: void;
  }>();

  let name = portal.name ?? '';
  let url  = portal.url  ?? '';
  let icon = portal.icon ?? '🌐';

  function handleSave() {
    if (!name.trim() || !url.trim()) return;
    dispatch('save', {
      id:        portal.id ?? crypto.randomUUID(),
      name:      name.trim(),
      url:       url.trim(),
      icon:      icon.trim() || '🌐',
      createdAt: portal.createdAt ?? Date.now(),
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    if (e.key === 'Escape') { e.preventDefault(); dispatch('cancel'); }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="portal-form">
  <div class="form-row">
    <label for="portal-name">Name</label>
    <input id="portal-name" type="text" bind:value={name} placeholder="Search Google" autofocus />
  </div>
  <div class="form-row">
    <label for="portal-url">URL</label>
    <input id="portal-url" type="text" bind:value={url} placeholder="https://google.com/search?q={'{query}'}" />
  </div>
  <div class="form-row">
    <label for="portal-icon">Icon</label>
    <input id="portal-icon" type="text" bind:value={icon} placeholder="🌐" maxlength="4" />
  </div>
  <p class="hint">Use <code>{'{query}'}</code> in the URL — it fills with your search text when you run the portal.</p>
  <div class="form-actions">
    <button class="btn-cancel" on:click={() => dispatch('cancel')}>Cancel</button>
    <button class="btn-save"   on:click={handleSave} disabled={!name.trim() || !url.trim()}>
      {isEditing ? 'Update' : 'Save'} <span class="hint-key">⌘S</span>
    </button>
  </div>
</div>

<style>
  .portal-form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--bg-secondary);
    border-radius: 10px;
    border: 1px solid var(--border-color);
  }
  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
  }
  input {
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 13px;
    outline: none;
  }
  input:focus {
    border-color: var(--accent-primary);
  }
  .hint {
    font-size: 11px;
    color: var(--text-tertiary);
    margin: 0;
  }
  code {
    font-family: monospace;
    background: var(--bg-hover);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
  .btn-cancel {
    padding: 6px 14px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: 13px;
    cursor: pointer;
  }
  .btn-save {
    padding: 6px 14px;
    border-radius: 6px;
    border: none;
    background: var(--accent-primary);
    color: white;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-save:disabled { opacity: 0.4; cursor: not-allowed; }
  .hint-key { font-size: 11px; opacity: 0.7; }
</style>
