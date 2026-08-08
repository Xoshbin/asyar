<script lang="ts">
  import { onMount } from 'svelte';
  import { FormField, Input, PlaceholderPicker } from '../../components';
  import type { Portal } from './portalStore.svelte';
  import { fetchPlaceholders } from '../../lib/placeholders/placeholderResolver';

  let {
    portal = {},
    isEditing = false,
    onsave,
    oncancel,
  }: {
    portal?: Partial<Portal>;
    isEditing?: boolean;
    onsave?: (portal: Portal) => void;
    oncancel?: () => void;
  } = $props();

  let name = $state('');
  let url = $state('');
  let icon = $state('🌐');

  let pickerOpen = $state(false);
  let urlInputEl: HTMLInputElement | undefined = $state();
  // Cursor position stored when picker was opened via `{` trigger; -1 = button-opened
  let triggerCursorPos = $state(-1);

  $effect(() => {
    name = portal.name ?? '';
    url = portal.url ?? '';
    icon = portal.icon ?? '🌐';
  });

  function handleSave() {
    if (!name.trim() || !url.trim()) return;
    onsave?.({
      id: portal.id ?? crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      icon: icon.trim() || '🌐',
      createdAt: portal.createdAt ?? Date.now(),
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (pickerOpen) return; // picker handles its own keys
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      oncancel?.();
    }
  }

  function handleUrlInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const cursorPos = input.selectionStart ?? input.value.length;
    const charBefore = input.value[cursorPos - 1];
    if (charBefore === '{') {
      triggerCursorPos = cursorPos;
      pickerOpen = true;
    }
  }

  function openPickerViaButton() {
    triggerCursorPos = -1; // button-triggered — no char to replace
    pickerOpen = true;
    // Focus the input so setRangeText works correctly
    urlInputEl?.focus();
  }

  function handleInsert(token: string) {
    if (!urlInputEl) return;
    urlInputEl.focus();

    if (triggerCursorPos > 0) {
      // User typed `{` to open the picker; replace the `{` with `{token}`
      const replaceStart = triggerCursorPos - 1;
      const replaceEnd = triggerCursorPos;
      urlInputEl.setRangeText('{' + token + '}', replaceStart, replaceEnd, 'end');
    } else {
      // Button-triggered; insert at current selection
      const start = urlInputEl.selectionStart ?? urlInputEl.value.length;
      const end = urlInputEl.selectionEnd ?? urlInputEl.value.length;
      urlInputEl.setRangeText('{' + token + '}', start, end, 'end');
    }

    // Sync Svelte state with the new input value
    url = urlInputEl.value;
  }

  function closePicker() {
    pickerOpen = false;
    triggerCursorPos = -1;
    urlInputEl?.focus();
  }

  // Build the help text listing all tokens
  let tokenList = $state('');

  onMount(async () => {
    const placeholders = await fetchPlaceholders();
    tokenList = placeholders.map((p) => `{${p.token}}`).join(', ');
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="portal-form p-4">
  <FormField label="Name" id="portal-name">
    <Input
      unstyled
      textIntent="natural"
      id="portal-name"
      class="field-input"
      type="text"
      bind:value={name}
      placeholder="Search Google"
      autofocus
    />
  </FormField>

  <div style="position: relative">
    <FormField label="URL" id="portal-url">
      <div class="url-input-row">
        <Input
          unstyled
          textIntent="exact"
          id="portal-url"
          class="field-input"
          type="text"
          bind:value={url}
          bind:ref={urlInputEl}
          placeholder="https://google.com/search?q={'{query}'}"
          oninput={handleUrlInput}
        />
        <button
          class="btn-secondary picker-toggle"
          type="button"
          title="Insert placeholder"
          onclick={openPickerViaButton}>{'{ }'}</button
        >
      </div>
    </FormField>

    {#if pickerOpen}
      <PlaceholderPicker onInsert={handleInsert} onClose={closePicker} />
    {/if}
  </div>

  <FormField label="Icon" id="portal-icon">
    <Input
      unstyled
      textIntent="exact"
      id="portal-icon"
      class="field-input"
      type="text"
      bind:value={icon}
      placeholder="🌐"
      maxlength={4}
    />
  </FormField>

  <p class="text-caption">
    Use placeholders in the URL: {tokenList}.<br />
    Press <code class="text-mono code-inline">{'{'}</code> or the <strong>{'{ }'}</strong> button to browse
    all placeholders.
  </p>

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
    gap: var(--space-6);
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
  .code-inline {
    background: var(--bg-hover);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
  }
  .shortcut-hint {
    opacity: 0.7;
    font-size: var(--font-size-xs);
    margin-left: var(--space-2);
    font-weight: 500;
  }
  .url-input-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
  :global(.url-input-row .field-input) {
    flex: 1;
    min-width: 0;
  }
  .picker-toggle {
    flex-shrink: 0;
    height: 32px;
    padding: 0 var(--space-4);
    font-family: monospace;
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
</style>
