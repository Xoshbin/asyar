<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsForm,
    SettingsFormRow,
    Checkbox,
    Button,
    Input,
    WarningBanner,
    ModalOverlay,
  } from '../../../components';
  import type { SettingsHandler } from '../settingsHandlers.svelte';
  import { BackupHandler } from './backupHandler.svelte';

  let { handler }: { handler: SettingsHandler } = $props();

  const backup = new BackupHandler();

  onMount(async () => {
    await backup.init();
  });
</script>

<!-- Export Backup & Restore -->
<div class="no-separators">
<SettingsForm>
  {#each backup.providers as provider (provider.id)}
    <SettingsFormRow label={provider.displayName}>
      <Checkbox
        checked={backup.enabledCategories.has(provider.id)}
        onchange={() => backup.toggleCategory(provider.id)}
      />
    </SettingsFormRow>
  {/each}

  {#if backup.hasSensitiveData}
    <div class="warning-row">
      <WarningBanner>
        This backup includes sensitive data (e.g. API keys). Set a password below to encrypt it,
        or leave it blank — sensitive fields will be stripped from the file.
      </WarningBanner>
    </div>
  {/if}

  <SettingsFormRow label="Password (optional)">
    <Input
      id="export-password"
      type="password"
      placeholder="Leave blank to strip sensitive fields"
      bind:value={backup.exportPassword}
    />
  </SettingsFormRow>

  <SettingsFormRow label="">
    <div class="action-row">
      <Button
        onclick={() => backup.handleExport()}
        disabled={backup.exportStatus === 'exporting' || backup.enabledCategories.size === 0}
      >
        {backup.exportStatus === 'exporting' ? 'Exporting…' : 'Export…'}
      </Button>
      {#if backup.exportMessage}
        <span class="status-text" class:error={backup.exportStatus === 'error'}>
          {backup.exportMessage}
        </span>
      {/if}
    </div>
  </SettingsFormRow>
</SettingsForm>

<!-- Restore from Backup -->
<SettingsForm>
  <SettingsFormRow label="" separator>
    <div class="action-row">
      <Button onclick={() => backup.handleChooseFile()}>
        Choose Backup File…
      </Button>
      {#if backup.importMessage && !backup.importModalOpen}
        <span class="status-text" class:error={backup.importStatus === 'error'}>
          {backup.importMessage}
        </span>
      {/if}
    </div>
  </SettingsFormRow>

  {#if backup.importNeedsPassword}
    <SettingsFormRow label="Password">
      <div class="import-password-row">
        <Input
          type="password"
          placeholder="Backup password"
          bind:value={backup.importPassword}
        />
        <Button onclick={() => backup.handleFileWithPassword()}>Unlock</Button>
      </div>
    </SettingsFormRow>
    {#if backup.importStatus === 'error' && backup.importMessage}
      <SettingsFormRow label="">
        <span class="status-text error">{backup.importMessage}</span>
      </SettingsFormRow>
    {/if}
  {/if}
</SettingsForm>
</div>

<!-- Import Preview Modal -->
{#if backup.importModalOpen && backup.importManifest}
  <ModalOverlay
    title="Restore from Backup"
    subtitle={new Date(backup.importManifest.exportedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
    width="560px"
  >
    {#snippet children()}
      <div class="space-y-1 max-h-80 overflow-y-auto">
        {#each backup.importManifest!.categories as cat (cat.id)}
          {@const catState = backup.importCategories.get(cat.id)}
          {@const preview = backup.importPreviewData.get(cat.id)}
          {#if catState}
            <div
              class="flex items-center gap-3 py-3 border-b"
              style="border-color: var(--border-color)"
            >
              <Checkbox
                checked={catState.enabled}
                onchange={() => {
                  const current = backup.importCategories.get(cat.id);
                  if (current) {
                    backup.importCategories = new Map([...backup.importCategories, [cat.id, { ...current, enabled: !current.enabled }]]);
                  }
                }}
              />
              <div class="flex-1 min-w-0">
                <div class="font-medium text-sm" style="color: var(--text-primary)">
                  {cat.displayName}
                </div>
                {#if preview}
                  <div class="text-xs mt-0.5" style="color: var(--text-secondary)">
                    Local: {preview.localCount} → Incoming: {preview.incomingCount}
                    {#if preview.conflicts > 0}
                      <span style="color: var(--accent-warning)"> · {preview.conflicts} conflicts</span>
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
                    backup.importCategories = new Map([...backup.importCategories, [cat.id, { ...current, strategy: e.currentTarget.value as import('../../../services/profile/types').ConflictStrategy }]]);
                  }
                }}
                class="text-sm px-2 py-1 rounded"
                style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: {catState.enabled ? 'var(--text-primary)' : 'var(--text-tertiary)'}; cursor: {catState.enabled ? 'pointer' : 'not-allowed'};"
              >
                <option value="merge">Merge</option>
                <option value="replace">Replace</option>
                <option value="skip">Skip</option>
              </select>
            </div>
          {/if}
        {/each}
      </div>

      {#if backup.importStatus === 'error' && backup.importMessage}
        <p class="text-sm mt-3" style="color: var(--accent-danger)">{backup.importMessage}</p>
      {/if}
    {/snippet}

    {#snippet actions()}
      <Button onclick={() => backup.closeImportModal()}>Cancel</Button>
      <Button
        onclick={() => backup.handleImport()}
        disabled={backup.importStatus === 'importing'}
      >
        {backup.importStatus === 'importing' ? 'Restoring…' : 'Restore'}
      </Button>
    {/snippet}
  </ModalOverlay>
{/if}

<style>
  .no-separators :global(.form-row) {
    border-bottom: none;
  }

  .no-separators :global(.form-row.separator) {
    border-top: none;
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
</style>
