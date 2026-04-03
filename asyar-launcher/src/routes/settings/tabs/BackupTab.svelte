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
