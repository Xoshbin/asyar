<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { snippetService, enabledPersistence } from './snippetService';
  import { snippetViewState } from './snippetViewState.svelte';
  import { viewManager } from '../../services/extension/viewManager.svelte';
  import {
    SplitListDetail,
    LauncherListRow,
    Badge,
    Icon,
    MetadataList,
    EmptyState,
    WarningBanner,
    Button,
  } from '../../components';
  import { actionService } from '../../services/action/actionService.svelte';
  import { t } from '../../services/i18n';

  let permissionGranted = $state(true);

  let filteredSnippets = $derived(snippetViewState.getFilteredSnippets());
  let selectedIndex = $derived(snippetViewState.selectedIndex);
  let selectedSnippet = $derived(snippetViewState.selectedSnippet);

  // Keep filteredActions and the bottom bar primary action synchronized when
  // snippet list length or selection changes (visible() predicates).
  $effect(() => {
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

  function openCreateSnippet() {
    snippetViewState.startCreate();
    viewManager.navigateToView('snippets/SnippetFormView', { searchable: false });
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
      {#if selectedSnippet}
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
            <Button class="btn-primary mt-4" onclick={openCreateSnippet}
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
  .pin-badge {
    color: var(--accent-primary);
  }
</style>
