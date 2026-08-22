<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle, Badge, EmptyState } from '../index';
  import { secretRedactionService } from '../../services/privacy/secretRedactionService.svelte';
  import { t } from '../../services/i18n';

  let totalRedacted = $derived(
    Object.values(secretRedactionService.sessionStats).reduce((a, b) => a + b, 0),
  );

  async function toggleMaster(next: boolean) {
    await secretRedactionService.setMasterEnabled(next);
  }

  async function toggleClipboard(next: boolean) {
    await secretRedactionService.setCategoryEnabled('clipboard', next);
  }

  async function toggleSnippets(next: boolean) {
    await secretRedactionService.setCategoryEnabled('snippets', next);
  }

  async function toggleAi(next: boolean) {
    await secretRedactionService.setCategoryEnabled('aiConversations', next);
  }
</script>

<div class="section-header">{t('settings.privacy.redaction_enabled')}</div>
<SettingsCard>
  <SettingsRow
    label={t('settings.privacy.redaction_enabled')}
    description={t('settings.privacy.redaction_enabled_desc')}
  >
    {#snippet children()}
      <Toggle checked={secretRedactionService.settings.master} onchange={toggleMaster} />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.clipboard_items')}
    description={t('settings.privacy.clipboard_items_desc')}
  >
    {#snippet children()}
      <Toggle
        checked={secretRedactionService.settings.clipboard}
        disabled={!secretRedactionService.settings.master}
        onchange={toggleClipboard}
      />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.snippets')}
    description={t('settings.privacy.snippets_desc')}
  >
    {#snippet children()}
      <Toggle
        checked={secretRedactionService.settings.snippets}
        disabled={!secretRedactionService.settings.master}
        onchange={toggleSnippets}
      />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.ai_conversations')}
    description={t('settings.privacy.ai_conversations_desc')}
  >
    {#snippet children()}
      <Toggle
        checked={secretRedactionService.settings.aiConversations}
        disabled={!secretRedactionService.settings.master}
        onchange={toggleAi}
      />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.this_session')}
    description={t('settings.privacy.this_session_desc')}
  >
    {#snippet children()}
      <Badge text={`${totalRedacted} redacted`} variant="info" />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label={t('settings.privacy.active_detectors')}
    description={t('settings.privacy.active_detectors_desc')}
  >
    {#snippet children()}
      {#if secretRedactionService.catalog.length === 0}
        <EmptyState message={t('settings.privacy.no_detectors')} />
      {:else}
        <ul class="catalog">
          {#each secretRedactionService.catalog as rule}
            <li class="catalog-row">
              <span class="text-body">{rule.kind}</span>
              <span class="text-caption">{rule.description}</span>
            </li>
          {/each}
        </ul>
      {/if}
    {/snippet}
  </SettingsRow>
</SettingsCard>

<style>
  .catalog {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .catalog-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
</style>
