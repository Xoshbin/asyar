<script lang="ts">
  import { onMount } from 'svelte';
  import { emit } from '@tauri-apps/api/event';
  import {
    Checkbox,
    Button,
    Input,
    WarningBanner,
    Modal,
    SettingsCard,
    SettingsRow,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { BackupHandler } from './backupHandler.svelte';
  import { t } from '../../../services/i18n';

  let { handler }: { handler: SettingsHandler } = $props();

  const backup = new BackupHandler();

  onMount(async () => {
    await backup.init();
  });

  // Settings is a separate webview with no extensionManager of its own, so
  // opening a Tier 1 view lives in the main launcher window — signal it via
  // a Tauri event that App.svelte listens for.
  function openRaycastImport() {
    emit('open-raycast-import');
  }
</script>

<div class="section-header">{t('settings.tabs.backup')}</div>
<div id="backup-export" class="anchor-group">
  <SettingsCard>
    <div class="category-list">
      {#each backup.exportCategories as cat (cat.id)}
        <div class="category-row">
          <Checkbox
            checked={backup.enabledCategories.has(cat.id)}
            onchange={() => backup.toggleCategory(cat.id)}
            disabled={backup.exportStatus === 'exporting'}
          >
            {cat.label}
          </Checkbox>
        </div>
      {/each}
    </div>

    {#if backup.exportWarning}
      <div class="warning-row">
        <WarningBanner message={backup.exportWarning} />
      </div>
    {/if}

    <SettingsRow
      label={t('settings.backup.password_optional')}
      description={t('settings.backup.password_optional_description')}
    >
      <Input
        textIntent="exact"
        id="export-password"
        type="password"
        placeholder={t('settings.backup.password_optional_placeholder')}
        bind:value={backup.exportPassword}
      />
    </SettingsRow>

    <SettingsRow label={t('settings.backup.export_backup')}>
      <div class="action-row">
        <Button
          onclick={() => backup.handleExport()}
          disabled={backup.exportStatus === 'exporting' || backup.enabledCategories.size === 0}
        >
          {backup.exportStatus === 'exporting'
            ? t('settings.backup.exporting')
            : t('settings.backup.export_button')}
        </Button>
        {#if backup.exportMessage}
          <span class="status-text" class:error={backup.exportStatus === 'error'}>
            {backup.exportMessage}
          </span>
        {/if}
      </div>
    </SettingsRow>
  </SettingsCard>
</div>

<div class="section-header">{t('settings.backup.section_raycast')}</div>
<div id="backup-raycast" class="anchor-group">
  <SettingsCard>
    <SettingsRow
      label={t('settings.backup.migrate_raycast')}
      description={t('settings.backup.migrate_raycast_description')}
    >
      <div class="action-row">
        <Button onclick={openRaycastImport}>{t('settings.backup.import_raycast_button')}</Button>
      </div>
    </SettingsRow>
  </SettingsCard>
</div>

<div class="section-header">{t('settings.backup.section_restore')}</div>
<div id="backup-import" class="anchor-group">
  <SettingsCard>
    <SettingsRow
      label={t('settings.backup.backup_file')}
      description={t('settings.backup.backup_file_description')}
    >
      <div class="action-row">
        <Button
          onclick={() => backup.handleChooseFile()}
          disabled={backup.importStatus === 'importing'}
        >
          {backup.importStatus === 'importing' && !backup.importNeedsPassword
            ? t('settings.backup.reading')
            : t('settings.backup.choose_backup_file')}
        </Button>
        {#if backup.importMessage && !backup.importModalOpen}
          <span class="status-text" class:error={backup.importStatus === 'error'}>
            {backup.importMessage}
          </span>
        {/if}
      </div>
    </SettingsRow>

    {#if backup.importNeedsPassword}
      <SettingsRow
        label={t('settings.backup.password')}
        description={t('settings.backup.password_description')}
      >
        <div class="import-password-row">
          <Input
            textIntent="exact"
            type="password"
            placeholder={t('settings.backup.backup_password_placeholder')}
            bind:value={backup.importPassword}
          />
          <Button
            onclick={() => backup.handleFileWithPassword()}
            disabled={backup.importStatus === 'importing'}
          >
            {backup.importStatus === 'importing'
              ? t('settings.backup.unlocking')
              : t('settings.backup.unlock')}
          </Button>
        </div>
      </SettingsRow>
      {#if backup.importStatus === 'error' && backup.importMessage}
        <SettingsRow label={t('settings.backup.import_error')}>
          <span class="status-text error">{backup.importMessage}</span>
        </SettingsRow>
      {/if}
    {/if}
  </SettingsCard>
</div>

<!-- Import Preview Modal -->
{#if backup.importModalOpen && backup.importManifest}
  <Modal
    isOpen={true}
    title={t('settings.backup.restore_modal_title')}
    subtitle={new Date(backup.importManifest.exportedAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}
    width="560px"
    onEscape={() => backup.closeImportModal()}
  >
    {#snippet children()}
      <div class="import-preview-list custom-scrollbar">
        {#each backup.importManifest!.categories as cat (cat.id)}
          {@const catState = backup.importCategories.get(cat.id)}
          {@const preview = backup.importPreviewData.get(cat.id)}
          {#if catState}
            <div class="import-preview-row">
              <Checkbox
                checked={catState.enabled}
                onchange={() => {
                  const current = backup.importCategories.get(cat.id);
                  if (current) {
                    backup.importCategories = new Map([
                      ...backup.importCategories,
                      [cat.id, { ...current, enabled: !current.enabled }],
                    ]);
                  }
                }}
              />
              <div class="import-preview-copy">
                <div class="import-preview-title">{cat.displayName}</div>
                {#if preview}
                  <div class="import-preview-meta">
                    Local: {preview.localCount} → Incoming: {preview.incomingCount}
                    {#if preview.conflicts > 0}
                      <span class="conflict-text"> · {preview.conflicts} conflicts</span>
                    {/if}
                  </div>
                {/if}
              </div>
              <select
                value={catState.strategy}
                disabled={!catState.enabled}
                oninput={(e) => {
                  const current = backup.importCategories.get(cat.id);
                  if (current) {
                    backup.importCategories = new Map([
                      ...backup.importCategories,
                      [
                        cat.id,
                        {
                          ...current,
                          strategy: e.currentTarget
                            .value as import('../../../services/profile/types').ConflictStrategy,
                        },
                      ],
                    ]);
                  }
                }}
                class="strategy-select"
              >
                <option value="merge">{t('settings.backup.strategy_merge')}</option>
                <option value="replace">{t('settings.backup.strategy_replace')}</option>
                <option value="skip">{t('settings.backup.strategy_skip')}</option>
              </select>
            </div>
          {/if}
        {/each}
      </div>

      {#if backup.importStatus === 'error' && backup.importMessage}
        <p class="modal-error">{backup.importMessage}</p>
      {/if}
    {/snippet}

    {#snippet actions()}
      <Button onclick={() => backup.closeImportModal()}>{t('common.cancel')}</Button>
      <Button onclick={() => backup.handleImport()} disabled={backup.importStatus === 'importing'}>
        {backup.importStatus === 'importing' ? t('common.restoring') : t('common.restore')}
      </Button>
    {/snippet}
  </Modal>
{/if}

<style>
  .anchor-group {
    scroll-margin-top: var(--space-6);
  }

  .warning-row {
    padding: var(--space-3) var(--space-6);
  }

  .action-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }

  .status-text {
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    color: var(--accent-success);
  }

  .status-text.error {
    color: var(--accent-danger);
  }

  .import-password-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .import-password-row :global(.input) {
    flex: 1;
  }

  .import-preview-list {
    max-height: 20rem;
    overflow-y: auto;
  }

  .import-preview-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border-color);
  }

  .import-preview-copy {
    flex: 1;
    min-width: 0;
  }

  .import-preview-title {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .import-preview-meta {
    margin-top: var(--space-0-5);
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }

  .conflict-text {
    color: var(--accent-warning);
  }

  .strategy-select {
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--font-size-sm);
    font-family: var(--font-ui);
    cursor: pointer;
  }

  .strategy-select:disabled {
    color: var(--text-tertiary);
    cursor: not-allowed;
  }

  .modal-error {
    margin: var(--space-3) 0 0;
    font-size: var(--font-size-sm);
    color: var(--accent-danger);
  }
</style>
