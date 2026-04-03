<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SettingsSection,
    SettingsRow,
    Toggle,
    Button,
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

<!-- Export Backup -->
<SettingsSection title="Export Backup">
  {#each backup.providers as provider (provider.id)}
    <SettingsRow
      label={provider.displayName}
      description={backup.localSummaries.get(provider.id)?.label ?? ''}
    >
      <Toggle
        checked={backup.enabledCategories.has(provider.id)}
        onchange={() => backup.toggleCategory(provider.id)}
      />
    </SettingsRow>
  {/each}

  {#if backup.hasSensitiveData}
    <div class="py-4">
      <WarningBanner>
        This backup includes sensitive data (e.g. API keys). Set a password below to encrypt it,
        or leave it blank — sensitive fields will be stripped from the file.
      </WarningBanner>
    </div>
  {/if}

  <div class="py-4 border-b border-[var(--border-color)]">
    <label
      class="block text-sm font-medium mb-2"
      style="color: var(--text-primary)"
      for="export-password"
    >
      Password <span style="color: var(--text-secondary); font-weight: normal">(optional)</span>
    </label>
    <input
      id="export-password"
      type="password"
      placeholder="Leave blank to strip sensitive fields"
      bind:value={backup.exportPassword}
      class="w-full px-3 py-2 rounded-md text-sm"
      style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); outline: none;"
    />
  </div>

  <div class="py-4 flex items-center gap-4">
    <Button
      onclick={() => backup.handleExport()}
      disabled={backup.exportStatus === 'exporting' || backup.enabledCategories.size === 0}
    >
      {backup.exportStatus === 'exporting' ? 'Exporting…' : 'Export…'}
    </Button>
    {#if backup.exportMessage}
      <span
        class="text-sm"
        style="color: {backup.exportStatus === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)'}"
      >
        {backup.exportMessage}
      </span>
    {/if}
  </div>
</SettingsSection>

<!-- Restore from Backup -->
<SettingsSection title="Restore from Backup">
  <div class="py-4 flex items-center gap-4">
    <Button onclick={() => backup.handleChooseFile()}>
      Choose Backup File…
    </Button>
    {#if backup.importMessage && !backup.importModalOpen}
      <span
        class="text-sm"
        style="color: {backup.importStatus === 'error' ? 'var(--accent-danger)' : 'var(--accent-success)'}"
      >
        {backup.importMessage}
      </span>
    {/if}
  </div>

  {#if backup.importNeedsPassword}
    <div class="pb-4">
      <p class="text-sm mb-2" style="color: var(--text-secondary)">
        This backup is password-protected. Enter password to decrypt.
      </p>
      <div class="flex items-center gap-3">
        <input
          type="password"
          placeholder="Backup password"
          bind:value={backup.importPassword}
          class="flex-1 px-3 py-2 rounded-md text-sm"
          style="background: var(--bg-tertiary); border: 1px solid var(--border-color); color: var(--text-primary); outline: none;"
        />
        <Button onclick={() => backup.handleFileWithPassword()}>Unlock</Button>
      </div>
      {#if backup.importStatus === 'error' && backup.importMessage}
        <p class="text-sm mt-2" style="color: var(--accent-danger)">{backup.importMessage}</p>
      {/if}
    </div>
  {/if}
</SettingsSection>

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
              <Toggle
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
