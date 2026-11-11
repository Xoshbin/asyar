<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { FormField, FormView, Input, PlaceholderPicker } from '../../components';
  import { portalStore, type Portal } from './portalStore.svelte';
  import { portalsUiState } from './index.svelte';
  import { syncPortalToIndex, removePortalFromIndex } from './portalLifecycle';
  import { fetchPlaceholders } from '../../lib/placeholders/placeholderResolver';
  import { actionService } from '../../services/action/actionService.svelte';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';

  let {
    portal,
    isEditing,
    onsave,
    oncancel,
  }: {
    portal?: Partial<Portal>;
    isEditing?: boolean;
    onsave?: (portal: Portal) => void | Promise<void>;
    oncancel?: () => void;
  } = $props();

  const resolvedIsEditing = $derived(
    isEditing ?? (portalsUiState.formMode === 'edit' && Boolean(portalsUiState.editingPortal)),
  );
  const resolvedPortal = $derived<Partial<Portal>>(
    portal ?? (resolvedIsEditing ? (portalsUiState.editingPortal ?? {}) : {}),
  );

  let cancelled = false;
  onDestroy(() => {
    cancelled = true;
  });

  let name = $state('');
  let url = $state('');
  let icon = $state('🌐');

  let pickerOpen = $state(false);
  let urlInputEl: HTMLInputElement | undefined = $state();
  // Cursor position stored when picker was opened via `{` trigger; -1 = button-opened
  let triggerCursorPos = $state(-1);

  $effect(() => {
    name = resolvedPortal.name ?? '';
    url = resolvedPortal.url ?? '';
    icon = resolvedPortal.icon ?? '🌐';
  });

  async function saveToStore(nextPortal: Portal): Promise<void> {
    try {
      if (resolvedIsEditing && resolvedPortal.id) {
        const editingId = resolvedPortal.id;
        portalStore.update(editingId, nextPortal);
        await removePortalFromIndex(editingId);
        await syncPortalToIndex({ ...nextPortal, id: editingId });
      } else {
        portalStore.add(nextPortal);
        await syncPortalToIndex(nextPortal);
        const idx = portalStore.portals.findIndex((p) => p.id === nextPortal.id);
        if (idx >= 0) portalsUiState.selectedIndex = idx;
      }
    } catch (err) {
      feedbackService.report({
        source: 'frontend',
        kind: 'manual',
        severity: 'error',
        retryable: false,
        context: { message: t('features.portals.ui.save_failed', { error: String(err) }) },
      });
    } finally {
      portalsUiState.clearDraft();
      if (!cancelled && viewManager.activeView === 'portals/PortalFormView') viewManager.goBack();
    }
  }

  async function handleSave() {
    if (!name.trim() || !url.trim()) return;
    const nextPortal: Portal = {
      id: resolvedPortal.id ?? crypto.randomUUID(),
      name: name.trim(),
      url: url.trim(),
      icon: icon.trim() || '🌐',
      createdAt: resolvedPortal.createdAt ?? Date.now(),
    };
    if (onsave) {
      await onsave(nextPortal);
      return;
    }
    await saveToStore(nextPortal);
  }

  function handleCancel() {
    if (pickerOpen) {
      closePicker();
      return false;
    }
    cancelled = true;
    if (oncancel) {
      oncancel();
      return;
    }
    portalsUiState.clearDraft();
    viewManager.goBack();
  }

  $effect(() => {
    actionService.registerAction({
      id: 'portals:insert-placeholder',
      label: t('features.portals.ui.insert_placeholder'),
      icon: 'icon:code',
      shortcut: 'Mod+Shift+P',
      category: t('categories.portals'),
      extensionId: 'portals',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => openPickerViaButton(),
    });
    return () => {
      actionService.unregisterAction('portals:insert-placeholder');
    };
  });

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

<FormView
  actionId="portals:save"
  submitLabel={resolvedIsEditing ? t('common.update') || 'Update' : t('common.save')}
  extensionId="portals"
  category={t('categories.portals')}
  submitDisabled={!name.trim() || !url.trim()}
  restoreSearchFocusOnCancel={true}
  onsubmit={handleSave}
  oncancel={handleCancel}
>
  {#snippet header()}
    <h2 class="form-title">{resolvedIsEditing ? 'Edit Portal' : 'New Portal'}</h2>
  {/snippet}

  <FormField label={t('common.name')} id="portal-name">
    <Input
      unstyled
      textIntent="natural"
      id="portal-name"
      class="field-input"
      type="text"
      bind:value={name}
      placeholder={t('features.portals.placeholder_search')}
    />
  </FormField>

  <div style="position: relative">
    <FormField label={t('features.portals.ui.url')} id="portal-url">
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
          tabindex={-1}
          title={t('features.portals.ui.insert_placeholder')}
          onclick={openPickerViaButton}>{'{ }'}</button
        >
      </div>
    </FormField>

    {#if pickerOpen}
      <PlaceholderPicker onInsert={handleInsert} onClose={closePicker} />
    {/if}
  </div>

  <FormField label={t('common.icon')} id="portal-icon">
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
    {t('features.portals.ui.use_placeholders', { tokens: tokenList })}<br />
    {t('features.portals.ui.browse_pre')} <code class="text-mono code-inline">{'{'}</code>
    {t('features.portals.ui.browse_mid')} <strong>{'{ }'}</strong>
    {t('features.portals.ui.browse_post')}
  </p>
</FormView>

<style>
  .form-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
  }
  .code-inline {
    background: var(--bg-hover);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
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
    height: var(--size-xl);
    padding: 0 var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
</style>
