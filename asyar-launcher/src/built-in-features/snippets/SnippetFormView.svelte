<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte';
  import {
    Button,
    FormField,
    FormView,
    Input,
    PlaceholderPicker,
    Textarea,
    Toggle,
  } from '../../components';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { actionService } from '../../services/action/actionService.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import { t } from '../../services/i18n';
  import { enabledPersistence, processSnippetExpansion, snippetService } from './snippetService';
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetUiState } from './snippetUiState.svelte';
  import { snippetViewState } from './snippetViewState.svelte';

  let saving = false;
  let saveGeneration = 0;
  let mounted = true;
  const ownsForm = () => mounted && viewManager.activeView === 'snippets/SnippetFormView';
  onDestroy(() => {
    mounted = false;
    ++saveGeneration;
  });
  onMount(async () => {
    const { permissionGranted } = await snippetService.onViewOpen();
    await snippetService.setEnabled(enabledPersistence.loadSync(true) && permissionGranted);
  });

  let formName = $state('');
  let formKeyword = $state('');
  let formExpansion = $state('');
  let formIsPrivate = $state(false);
  let formError = $state<string | null>(null);
  let formId = $state('');

  let pickerOpen = $state(false);
  let triggerCursorPos = $state(-1);
  let formExpansionEl: HTMLTextAreaElement | undefined = $state();

  const isEdit = $derived(
    snippetViewState.mode === 'edit' && Boolean(snippetViewState.editingSnippet),
  );

  // Seed form fields whenever the active draft target (create/edit) changes.
  $effect(() => {
    const mode = snippetViewState.mode;
    const editing = snippetViewState.editingSnippet;
    const prefill = untrack(() => snippetUiState.prefillExpansion);
    if (mode === 'edit' && editing) {
      formName = editing.name;
      formKeyword = editing.keyword ?? '';
      formExpansion = editing.expansion;
      formIsPrivate = editing.isPrivate ?? false;
      formError = null;
      formId = editing.id;
    } else {
      formName = '';
      formKeyword = '';
      formExpansion = prefill ?? '';
      formIsPrivate = false;
      formError = null;
      formId = crypto.randomUUID();
      if (prefill !== null) {
        snippetUiState.prefillExpansion = null;
      }
    }
  });

  $effect(() => {
    actionService.registerAction({
      id: 'snippets:insert-placeholder',
      label: t('features.snippets.ui.insert_placeholder'),
      icon: 'icon:code',
      shortcut: 'Mod+Shift+P',
      category: t('categories.snippets'),
      extensionId: 'snippets',
      context: ActionContext.EXTENSION_VIEW,
      execute: () => openPickerViaButton(),
    });
    return () => {
      actionService.unregisterAction('snippets:insert-placeholder');
    };
  });

  function handleExpansionInput(e: Event) {
    const input = e.target as HTMLTextAreaElement;
    const cursorPos = input.selectionStart ?? input.value.length;
    const charBefore = input.value[cursorPos - 1];
    if (charBefore === '{') {
      triggerCursorPos = cursorPos;
      pickerOpen = true;
    }
  }

  function openPickerViaButton() {
    triggerCursorPos = -1;
    pickerOpen = true;
    formExpansionEl?.focus();
  }

  function handleInsert(token: string) {
    if (!formExpansionEl) return;
    formExpansionEl.focus();
    if (triggerCursorPos > 0) {
      const replaceStart = triggerCursorPos - 1;
      const replaceEnd = triggerCursorPos;
      formExpansionEl.setRangeText('{' + token + '}', replaceStart, replaceEnd, 'end');
    } else {
      const start = formExpansionEl.selectionStart ?? formExpansionEl.value.length;
      const end = formExpansionEl.selectionEnd ?? formExpansionEl.value.length;
      formExpansionEl.setRangeText('{' + token + '}', start, end, 'end');
    }
    formExpansion = formExpansionEl.value;
  }

  async function handleSave() {
    if (saving || !ownsForm()) return;
    if (!formName.trim()) {
      formError = 'Name is required.';
      return;
    }
    if (!formExpansion.trim()) {
      formError = 'Expansion is required.';
      return;
    }
    if (formKeyword.trim() && /[A-Z]/.test(formKeyword)) {
      formError = 'Keyword must be lowercase.';
      return;
    }
    const isDuplicate =
      formKeyword.trim() &&
      snippetStore.getAll().some((s) => s.keyword === formKeyword.trim() && s.id !== formId);
    if (isDuplicate) {
      formError = 'Keyword is already in use.';
      return;
    }

    saving = true;
    const generation = ++saveGeneration;
    try {
      const { expansion: processedExpansion, redactedKinds } =
        await processSnippetExpansion(formExpansion);
      if (generation !== saveGeneration || !ownsForm()) return;
      const payload: Snippet = {
        id: formId,
        name: formName.trim(),
        keyword: formKeyword.trim().toLowerCase(),
        expansion: processedExpansion,
        isPrivate: formIsPrivate,
        createdAt: snippetViewState.editingSnippet?.createdAt ?? Date.now(),
        redactedKinds,
      };

      if (isEdit) {
        snippetStore.update(formId, payload);
      } else {
        snippetStore.add(payload);
        await snippetViewState.selectAfterMutation(formId);
      }
      await snippetService.syncToRust();
      if (generation !== saveGeneration || !ownsForm()) return;
      snippetUiState.prefillExpansion = null;
      snippetViewState.cancelEdit();
      viewManager.goBack();
    } finally {
      saving = false;
    }
  }

  function handleCancel() {
    if (pickerOpen) {
      pickerOpen = false;
      formExpansionEl?.focus();
      return false;
    }
    ++saveGeneration;
    snippetUiState.prefillExpansion = null;
    snippetViewState.cancelEdit();
    viewManager.goBack();
  }
</script>

<FormView
  actionId="snippets:save"
  submitLabel={isEdit ? t('common.save') : t('features.snippets.act.add')}
  extensionId="snippets"
  category={t('categories.snippets')}
  restoreSearchFocusOnCancel={true}
  onsubmit={handleSave}
  oncancel={handleCancel}
>
  {#snippet header()}
    <h2 class="form-title">
      {isEdit ? 'Edit Snippet' : 'New Snippet'}
    </h2>
  {/snippet}

  <FormField label={t('features.snippets.name_label')} id="form-name">
    <Input
      unstyled
      textIntent="natural"
      id="form-name"
      class="field-input"
      type="text"
      autocomplete="off"
      bind:value={formName}
      placeholder={t('features.snippets.ui.name_placeholder')}
    />
  </FormField>
  <FormField
    label={t('features.snippets.ui.keyword_optional')}
    id="form-keyword"
    hint={t('features.snippets.ui.keyword_hint')}
  >
    <Input
      unstyled
      textIntent="exact"
      id="form-keyword"
      class="field-input"
      type="text"
      autocomplete="off"
      bind:value={formKeyword}
      placeholder="e.g. ;email"
    />
  </FormField>
  <FormField label={t('features.snippets.ui.expansion')} id="form-expansion">
    <div style="position: relative">
      <div class="textarea-wrapper">
        <Textarea
          unstyled
          textIntent="verbatim"
          id="form-expansion"
          class="field-textarea"
          autocomplete="off"
          bind:value={formExpansion}
          bind:ref={formExpansionEl}
          oninput={handleExpansionInput}
          placeholder="e.g. hello@example.com"
          rows="5"
        ></Textarea>
        <Button
          class="picker-toggle"
          tabindex={-1}
          title={t('features.snippets.ui.insert_placeholder')}
          onclick={openPickerViaButton}>{'{ }'}</Button
        >
      </div>
      {#if pickerOpen}
        <PlaceholderPicker onInsert={handleInsert} onClose={() => (pickerOpen = false)} />
      {/if}
    </div>
    <p class="text-caption mt-2">
      Supported: {`{Selected Text}, {Clipboard Text}, {UUID}, {Date}, {Time}, {Weekday}`}. Custom
      format supported e.g.
      <code class="code-inline">{'{Date format="YYYY-MM-DD"}'}</code>.<br />
      {t('features.snippets.ui.browse_pre')} <code class="code-inline">{'{'}</code>
      {t('features.snippets.ui.browse_post')}
    </p>
  </FormField>
  <div class="private-toggle-row">
    <div class="toggle-info">
      <span class="toggle-label">{t('features.snippets.private_label')}</span>
      <span class="toggle-hint">{t('features.snippets.private_hint')}</span>
    </div>
    <Toggle id="form-is-private" bind:checked={formIsPrivate} />
  </div>
  {#if formError}
    <div class="form-error">{formError}</div>
  {/if}
</FormView>

<style>
  .form-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 var(--space-2);
  }
  .form-error {
    font-size: var(--font-size-sm);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    color: var(--accent-danger);
    background: color-mix(in srgb, var(--accent-danger) 10%, transparent);
  }
  .textarea-wrapper {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  :global(.textarea-wrapper .field-textarea) {
    flex: 1;
    font-family: var(--font-mono);
    line-height: 1.5;
  }
  :global(.picker-toggle) {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
  .code-inline {
    background: var(--bg-hover);
    padding: var(--space-0-5) var(--space-1);
    border-radius: var(--radius-xs);
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .private-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-top: 1px solid var(--separator);
  }
  .toggle-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .toggle-label {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
  }
  .toggle-hint {
    font-size: var(--font-size-xs);
    color: var(--text-tertiary);
  }
</style>
