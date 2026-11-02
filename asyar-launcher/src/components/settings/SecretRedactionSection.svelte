<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle, Badge, Button, EmptyState } from '../index';
  import { secretRedactionService } from '../../services/privacy/secretRedactionService.svelte';
  import { t } from '../../services/i18n';

  let showDetectors = $state(false);

  let totalRedacted = $derived(
    Object.values(secretRedactionService.sessionStats).reduce((a, b) => a + b, 0),
  );

  // `Toggle` forwards the raw DOM change event (unlike `Checkbox`, which hands
  // over a boolean), so the new value has to be read off the input itself.
  function isChecked(e: Event): boolean {
    return (e.currentTarget as HTMLInputElement).checked;
  }

  async function toggleMaster(e: Event) {
    await secretRedactionService.setMasterEnabled(isChecked(e));
  }

  async function toggleClipboard(e: Event) {
    await secretRedactionService.setCategoryEnabled('clipboard', isChecked(e));
  }

  async function toggleSnippets(e: Event) {
    await secretRedactionService.setCategoryEnabled('snippets', isChecked(e));
  }

  async function toggleAi(e: Event) {
    await secretRedactionService.setCategoryEnabled('aiConversations', isChecked(e));
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
      <div class="detectors-control">
        <Badge
          text={t('settings.privacy.detector_count', {
            count: secretRedactionService.catalog.length,
          })}
          variant="info"
        />
        <Button onclick={() => (showDetectors = !showDetectors)} aria-expanded={showDetectors}>
          {showDetectors
            ? t('settings.privacy.hide_detectors')
            : t('settings.privacy.show_detectors')}
        </Button>
      </div>
    {/snippet}
  </SettingsRow>

  {#if showDetectors}
    <div class="detectors">
      {#if secretRedactionService.catalog.length === 0}
        <EmptyState message={t('settings.privacy.no_detectors')} />
      {:else}
        <ul class="catalog">
          {#each secretRedactionService.catalog as rule (rule.kind)}
            <li class="catalog-row">
              <span class="catalog-kind">{rule.kind}</span>
              <span class="catalog-desc">{rule.description}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</SettingsCard>

<style>
  .detectors-control {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .detectors {
    padding: var(--space-4) var(--space-6) var(--space-5);
    border-top: 1px solid var(--border-color);
  }

  .catalog {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3) var(--space-5);
  }

  .catalog-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    min-width: 0;
  }

  .catalog-kind {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--text-primary);
  }

  .catalog-desc {
    font-size: var(--font-size-xs);
    color: var(--text-secondary);
  }
</style>
