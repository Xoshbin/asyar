<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { Button, Input, Toggle, EmptyState, LoadingState, Card, Icon } from '../../components';
  import { raycastImportState as state } from './raycastImportState.svelte';
  import { setFocusLock } from '../../lib/ipc/commands';
  import { logService } from '../../services/log/logService';
  import { t } from '../../services/i18n';

  async function pickFile() {
    // The native file dialog steals window focus; without a lock the
    // launcher's hide-on-blur (panel resign-key on macOS, window blur
    // elsewhere) closes it right under the dialog. Same pattern as
    // CreateExtensionView's handleBrowse.
    await setFocusLock(true);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Raycast export', extensions: ['rayconfig', 'json'] }],
      });
      if (typeof selected === 'string') {
        await state.chooseFile(selected);
      }
    } catch (e) {
      logService.error(`Raycast import: file dialog error: ${e}`);
    } finally {
      await setFocusLock(false);
    }
  }

  function fileName(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  const categories = $derived([
    {
      key: 'snippets' as const,
      label: t('features.raycast_import.category_snippets'),
      count: state.bundle?.snippets.length ?? 0,
      hint: t('features.raycast_import.category_snippets_hint'),
    },
    {
      key: 'portals' as const,
      label: t('features.raycast_import.category_portals'),
      count: state.bundle?.portals.length ?? 0,
      hint: t('features.raycast_import.category_portals_hint'),
    },
    {
      key: 'shortcuts' as const,
      label: t('features.raycast_import.category_shortcuts'),
      count: state.bundle?.shortcuts.length ?? 0,
      hint: t('features.raycast_import.category_shortcuts_hint'),
    },
    {
      key: 'aliases' as const,
      label: t('features.raycast_import.category_aliases'),
      count: state.bundle?.aliases.length ?? 0,
      hint: t('features.raycast_import.category_aliases_hint'),
    },
  ]);
</script>

<div class="raycast-import-view">
  <div class="import-body custom-scrollbar">
    {#if state.phase === 'pick'}
      <EmptyState
        message={t('features.raycast_import.import_title')}
        description={t('features.raycast_import.import_description')}
      >
        {#snippet icon()}
          <Icon name="download" size={28} />
        {/snippet}
        <Button class="btn-primary" onclick={pickFile} disabled={state.parsing}>
          Choose export file…
        </Button>
      </EmptyState>
    {:else if state.phase === 'password'}
      <div class="import-step">
        <p class="text-title">This export is password-protected</p>
        <p class="text-caption">
          Enter the password you set in Raycast when exporting
          {#if state.filePath}“{fileName(state.filePath)}”{/if}.
        </p>
        <Input
          textIntent="exact"
          type="password"
          placeholder="Export password"
          bind:value={state.password}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter') state.submitPassword();
          }}
        />
        {#if state.passwordError}
          <p class="text-caption password-error">Incorrect password — try again.</p>
        {/if}
        <div class="import-actions">
          <Button onclick={() => state.reset()}>Back</Button>
          <Button
            class="btn-primary"
            onclick={() => state.submitPassword()}
            disabled={!state.password || state.parsing}
          >
            Unlock
          </Button>
        </div>
      </div>
    {:else if state.phase === 'preview' && state.bundle}
      <div class="import-step">
        <p class="text-title">
          Found in {state.filePath ? fileName(state.filePath) : 'export'}
        </p>
        <Card>
          {#each categories as category (category.key)}
            <div class="category-row">
              <div class="category-text">
                <span class="text-body">{category.label}</span>
                <span class="text-caption">{category.hint}</span>
              </div>
              <span class="category-count text-subtitle">{category.count}</span>
              <Toggle
                bind:checked={state.selection[category.key]}
                disabled={category.count === 0}
              />
            </div>
          {/each}
        </Card>
        {#if state.bundle.skipped.hotkeys > 0 || state.bundle.skipped.aliases > 0}
          <p class="text-caption">
            Not importable:
            {#if state.bundle.skipped.hotkeys > 0}
              {state.bundle.skipped.hotkeys} hotkey{state.bundle.skipped.hotkeys === 1 ? '' : 's'}
              bound to Raycast commands or missing apps{/if}{#if state.bundle.skipped.hotkeys > 0 && state.bundle.skipped.aliases > 0},
            {/if}
            {#if state.bundle.skipped.aliases > 0}
              {state.bundle.skipped.aliases} alias{state.bundle.skipped.aliases === 1 ? '' : 'es'}
              bound to Raycast commands, missing apps, or with characters Asyar can't use{/if}.
          </p>
        {/if}
        <div class="import-actions">
          <Button onclick={() => state.reset()}>Back</Button>
          <Button
            class="btn-primary"
            onclick={() => state.runImport()}
            disabled={!state.selection.snippets &&
              !state.selection.portals &&
              !state.selection.shortcuts &&
              !state.selection.aliases}
          >
            Import
          </Button>
        </div>
      </div>
    {:else if state.phase === 'importing'}
      <LoadingState message="Importing…" />
    {:else if state.phase === 'error'}
      <div class="import-step">
        <p class="text-title">Import failed</p>
        <p class="text-caption password-error">{state.errorMessage}</p>
        <div class="import-actions">
          <Button onclick={() => state.reset()}>Start over</Button>
          <Button class="btn-primary" onclick={() => state.backToPreview()}>Back to preview</Button>
        </div>
      </div>
    {:else if state.phase === 'done' && state.summary}
      <EmptyState
        message={t('features.raycast_import.import_complete')}
        description={t('features.raycast_import.import_complete_description')}
      >
        {#snippet icon()}
          <Icon name="download" size={28} />
        {/snippet}
        <div class="summary-rows">
          <span class="text-body"
            >Snippets: {state.summary.snippets.added} added, {state.summary.snippets.skipped} skipped</span
          >
          <span class="text-body"
            >Portals: {state.summary.portals.added} added, {state.summary.portals.skipped} skipped</span
          >
          <span class="text-body"
            >Shortcuts: {state.summary.shortcuts.added} added, {state.summary.shortcuts.skipped} skipped</span
          >
          <span class="text-body"
            >Aliases: {state.summary.aliases.added} added, {state.summary.aliases.skipped} skipped</span
          >
        </div>
        <Button class="btn-primary" onclick={() => state.reset()}>Import another file</Button>
      </EmptyState>
    {/if}
  </div>
</div>

<style>
  .raycast-import-view {
    height: 100%;
    display: flex;
    flex-direction: column;
  }

  .import-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-6);
  }

  .import-step {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 32rem;
    margin: 0 auto;
  }

  .import-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
  }

  .category-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) 0;
  }

  .category-row + .category-row {
    border-top: 1px solid var(--separator);
  }

  .category-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .category-count {
    min-width: var(--size-lg);
    text-align: right;
  }

  .password-error {
    color: var(--accent-danger);
  }

  .summary-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-4);
  }
</style>
