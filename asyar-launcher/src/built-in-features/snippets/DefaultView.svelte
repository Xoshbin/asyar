<script lang="ts">
  import { Input, Textarea } from '../../components';
  import { onMount, untrack } from 'svelte';
  import { snippetStore, type Snippet } from './snippetStore.svelte';
  import { snippetService, enabledPersistence, processSnippetExpansion } from './snippetService';
  import { snippetUiState } from './snippetUiState.svelte';
  import { snippetViewState } from './snippetViewState.svelte';
  import {
    SplitListDetail,
    LauncherListRow,
    Badge,
    Icon,
    MetadataList,
    EmptyState,
    WarningBanner,
    FormField,
    FormView,
    Button,
    PlaceholderPicker,
    Toggle,
  } from '../../components';
  import { feedbackService } from '../../services/feedback/feedbackService.svelte';
  import { actionService } from '../../services/action/actionService.svelte';
  import { ActionContext } from 'asyar-sdk/contracts';
  import { t } from '../../services/i18n';

  let permissionGranted = $state(true);
  let prefillExpansion = $state<string | null>(null);

  // Watch clipboard-history integration trigger
  $effect(() => {
    if (snippetUiState.editorTrigger === 'add') {
      prefillExpansion = snippetUiState.prefillExpansion;
      snippetUiState.editorTrigger = null;
      snippetUiState.prefillExpansion = null;
      snippetViewState.startCreate();
    }
  });

  // Inline form state
  let formName = $state('');
  let formKeyword = $state('');
  let formExpansion = $state('');
  let formIsPrivate = $state(false);
  let formError = $state<string | null>(null);
  let formId = $state('');

  let pickerOpen = $state(false);
  let triggerCursorPos = $state(-1);
  let formExpansionEl: HTMLTextAreaElement | undefined = $state();

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

  // Sync form fields when mode or editingSnippet changes
  $effect(() => {
    if (snippetViewState.mode === 'create') {
      formName = '';
      formKeyword = '';
      formExpansion = prefillExpansion ?? '';
      formIsPrivate = false;
      formError = null;
      formId = crypto.randomUUID();
    } else if (snippetViewState.mode === 'edit' && snippetViewState.editingSnippet) {
      const s = snippetViewState.editingSnippet;
      formName = s.name;
      formKeyword = s.keyword ?? '';
      formExpansion = s.expansion;
      formIsPrivate = s.isPrivate ?? false;
      formError = null;
      formId = s.id;
    }
  });

  let filteredSnippets = $derived(snippetViewState.getFilteredSnippets());
  let selectedIndex = $derived(snippetViewState.selectedIndex);
  let selectedSnippet = $derived(snippetViewState.selectedSnippet);

  // Keep filteredActions and the bottom bar primary action synchronized when
  // snippet list length, selection, or mode changes (visible() predicates).
  $effect(() => {
    snippetViewState.mode;
    filteredSnippets.length;
    selectedSnippet?.id;
    untrack(() => actionService.refreshFiltered());
  });

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  onMount(async () => {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    const currentEnabled = enabledPersistence.loadSync(true);
    await snippetService.setEnabled(currentEnabled && permissionGranted);
  });

  async function handleSave() {
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

    const { expansion: processedExpansion, redactedKinds } =
      await processSnippetExpansion(formExpansion);
    const payload: Snippet = {
      id: formId,
      name: formName.trim(),
      keyword: formKeyword.trim().toLowerCase(),
      expansion: processedExpansion,
      isPrivate: formIsPrivate,
      createdAt: snippetViewState.editingSnippet?.createdAt ?? Date.now(),
      redactedKinds,
    };

    if (snippetViewState.mode === 'edit') {
      snippetStore.update(formId, payload);
    } else {
      snippetStore.add(payload);
      // Select new snippet
      await snippetViewState.selectAfterMutation(formId);
    }
    await snippetService.syncToRust();
    prefillExpansion = null;
    snippetViewState.cancelEdit();
  }

  $effect(() => {
    if (snippetViewState.mode !== 'edit' && snippetViewState.mode !== 'create') {
      actionService.unregisterAction('snippets:insert-placeholder');
      return;
    }
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

  function cancelSnippetForm() {
    if (pickerOpen) {
      pickerOpen = false;
      formExpansionEl?.focus();
      return;
    }
    snippetViewState.cancelEdit();
    prefillExpansion = null;
  }

  async function recheckPermission() {
    const result = await snippetService.onViewOpen();
    permissionGranted = result.permissionGranted;
    const currentEnabled = enabledPersistence.loadSync(true);
    if (permissionGranted && currentEnabled) await snippetService.setEnabled(true);
  }
</script>

<div class="view-container">
  {#if !permissionGranted}
    <div class="permission-banner-wrapper">
      <WarningBanner>
        {#snippet children()}
          <p>
            {t('features.snippets.ui.accessibility_warning')}
          </p>
        {/snippet}
        {#snippet actions()}
          <Button onclick={() => snippetService.openAccessibilityPreferences()}
            >{t('features.snippets.ui.open_settings')}</Button
          >
          <Button onclick={recheckPermission}>{t('features.snippets.ui.recheck')}</Button>
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
    emptyMessage={t('features.snippets.no_snippets')}
  >
    {#snippet listItem(snippet, index)}
      {#if index === 0 && snippetViewState.pinnedCount > 0}
        <div class="list-section">{t('common.pinned')}</div>
      {/if}
      {#if index === snippetViewState.pinnedCount && snippetViewState.pinnedCount > 0}
        <div class="list-section">{t('features.snippets.ui.all')}</div>
      {/if}
      <LauncherListRow
        data-index={index}
        selected={selectedIndex === index}
        title={snippet.name}
        subtitle={snippet.keyword ? snippet.keyword : undefined}
        onclick={() => snippetViewState.selectItem(index)}
      >
        {#snippet leading()}
          <div class="leading-icon">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
              />
            </svg>
          </div>
        {/snippet}
        {#snippet trailing()}
          {#if snippet.isPrivate || snippet.pinned}
            <div class="flex items-center gap-1.5 flex-shrink-0">
              {#if snippet.isPrivate}
                <Badge text={t('features.snippets.private_badge')} variant="warning" />
              {/if}
              {#if snippet.pinned}
                <span
                  class="pin-badge flex items-center justify-center opacity-70"
                  aria-label={t('common.pinned')}
                  data-testid="snippet-pin-icon"
                >
                  <Icon name="pin" size={13} />
                </span>
              {/if}
            </div>
          {/if}
        {/snippet}
      </LauncherListRow>
    {/snippet}

    {#snippet detail()}
      {#if snippetViewState.mode === 'edit' || snippetViewState.mode === 'create'}
        <!-- Keyboard-first inline form: primary submit in bottom bar (⌘↵), Esc cancels -->
        <FormView
          actionId="snippets:save"
          submitLabel={snippetViewState.mode === 'edit'
            ? t('common.save')
            : t('features.snippets.act.add')}
          extensionId="snippets"
          category={t('categories.snippets')}
          restoreSearchFocusOnCancel={true}
          onsubmit={handleSave}
          oncancel={cancelSnippetForm}
        >
          {#snippet header()}
            <h2 class="form-title">
              {snippetViewState.mode === 'edit' ? 'Edit Snippet' : 'New Snippet'}
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
              Supported: {`{Selected Text}, {Clipboard Text}, {UUID}, {Date}, {Time}, {Weekday}`}.
              Custom format supported e.g.
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
      {:else if selectedSnippet}
        <!-- Detail view -->
        <div class="snippet-detail-content custom-scrollbar">
          <div class="detail-header">
            <div class="flex items-center gap-2 min-w-0">
              <h2 class="snippet-name truncate">{selectedSnippet.name}</h2>
              {#if selectedSnippet.isPrivate}
                <Badge text={t('features.snippets.private_badge')} variant="warning" />
              {/if}
            </div>
          </div>
          {#if selectedSnippet.keyword}
            <div class="keyword-row">
              <Badge text={selectedSnippet.keyword} variant="default" mono />
            </div>
          {/if}
          {#if selectedSnippet.redactedKinds?.length}
            <div class="flex items-center gap-3 p-6">
              <Badge text={t('features.snippets.ui.encrypted_secret')} variant="warning" />
              <span class="text-caption">
                {selectedSnippet.redactedKinds.join(', ')} — expands to the original value
              </span>
            </div>
          {:else}
            <pre class="snippet-expansion">{selectedSnippet.expansion}</pre>
          {/if}
        </div>
        <MetadataList
          title={t('common.information')}
          items={[
            {
              label: t('features.snippets.ui.keyword'),
              value: selectedSnippet.keyword,
              mono: true,
            },
            {
              label: t('features.snippets.ui.length'),
              value: selectedSnippet.redactedKinds?.length
                ? null
                : `${selectedSnippet.expansion.length} chars`,
            },
            {
              label: t('features.snippets.ui.visibility'),
              value: selectedSnippet.isPrivate
                ? t('features.snippets.ui.visibility_private')
                : t('features.snippets.ui.visibility_synced'),
            },
            {
              label: t('features.snippets.ui.created'),
              value: dateFormat.format(selectedSnippet.createdAt),
            },
          ]}
        />
      {:else}
        <!-- Nothing selected -->
        <EmptyState
          message={filteredSnippets.length === 0
            ? t('features.snippets.no_snippets')
            : t('features.snippets.select_snippet')}
          description={filteredSnippets.length === 0
            ? t('features.snippets.no_snippets_description')
            : t('features.snippets.select_snippet_description')}
        >
          {#snippet icon()}
            <svg class="w-16 h-16 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
              />
            </svg>
          {/snippet}
          {#if filteredSnippets.length === 0}
            <Button class="btn-primary mt-4" onclick={() => snippetViewState.startCreate()}
              >{t('features.snippets.ui.add_first')}</Button
            >
          {/if}
        </EmptyState>
      {/if}
    {/snippet}
  </SplitListDetail>
</div>

<style>
  .permission-banner-wrapper {
    margin: var(--space-5) var(--space-6) 0;
  }
  .leading-icon {
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: var(--space-1);
  }

  /* Detail view */
  .snippet-detail-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-5);
  }
  .snippet-name {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  .keyword-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .snippet-expansion {
    font-family: var(--font-mono);
    font-size: var(--font-size-md);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--bg-secondary);
    border-radius: var(--radius-sm);
    padding: var(--space-6);
    margin: 0;
  }
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
  .pin-badge {
    color: var(--accent-primary);
  }
</style>
