<script lang="ts">
  import { SettingsCard, SettingsRow, Input, Button, Badge, EmptyState } from '../index';
  import { clipboardPrivacyService } from '../../services/privacy/clipboardPrivacyService.svelte';
  import { t } from '../../services/i18n';

  let newEntry = $state('');

  let totalSkipped = $derived(
    Object.values(clipboardPrivacyService.sessionStats).reduce((a, b) => a + b, 0),
  );

  let isLinux = $derived(
    typeof document !== 'undefined' && document.documentElement.dataset.platform === 'linux',
  );

  async function handleAdd() {
    const trimmed = newEntry.trim();
    if (!trimmed) return;
    await clipboardPrivacyService.addToDenylist(trimmed);
    newEntry = '';
  }
</script>

<div class="section-header">{t('settings.privacy.clipboard_items')}</div>
<SettingsCard>
  <SettingsRow
    label={t('settings.privacy.clipboard_privacy')}
    description={t('settings.privacy.clipboard_privacy_desc')}
  >
    {#snippet children()}
      <Badge text="Protected" variant="info" />
    {/snippet}
  </SettingsRow>

  {#if isLinux}
    <SettingsRow
      label="Platform note"
      description="Your Linux desktop does not provide a standard clipboard exclusion API. Source-app filtering only."
    >
      {#snippet children()}
        <Badge text="Source filter only" variant="info" />
      {/snippet}
    </SettingsRow>
  {/if}

  <SettingsRow
    label={t('settings.privacy.this_session')}
    description={t('settings.privacy.clipboard_session_desc')}
  >
    {#snippet children()}
      <Badge text={`${totalSkipped} skipped`} variant="info" />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.default_denylist')}
    description={t('settings.privacy.default_denylist_desc')}
  >
    {#snippet children()}
      {#if clipboardPrivacyService.defaultDenylist.length === 0}
        <EmptyState message={t('settings.privacy.no_defaults')} />
      {:else}
        <ul class="denylist">
          {#each clipboardPrivacyService.defaultDenylist as bundleId}
            <li class="denylist-row text-caption">{bundleId}</li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.add_bundle_id')}
    description={t('settings.privacy.add_bundle_id_desc')}
  >
    {#snippet children()}
      <div class="add-row">
        <Input textIntent="exact" bind:value={newEntry} placeholder="com.example.YourVault" />
        <Button onclick={handleAdd} disabled={newEntry.trim().length === 0}
          >{t('common.add')}</Button
        >
      </div>
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.your_additions')}
    description={t('settings.privacy.your_additions_desc')}
  >
    {#snippet children()}
      {#if clipboardPrivacyService.userDenylist.length === 0}
        <EmptyState message={t('settings.privacy.no_custom_entries')} />
      {:else}
        <ul class="denylist">
          {#each clipboardPrivacyService.userDenylist as bundleId}
            <li class="denylist-row user-row">
              <span class="text-body">{bundleId}</span>
              <Button onclick={() => clipboardPrivacyService.removeFromDenylist(bundleId)}>
                Remove
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </SettingsRow>
</SettingsCard>

<style>
  .denylist {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .denylist-row {
    color: var(--text-secondary);
  }

  .user-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .add-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }
</style>
