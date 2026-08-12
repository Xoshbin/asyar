<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle, Badge, EmptyState } from '../index';
  import { secretRedactionService } from '../../services/privacy/secretRedactionService.svelte';

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

<div class="section-header">Redaction</div>
<SettingsCard>
  <SettingsRow
    label="Enabled"
    description="Master switch for redacting known secret formats before storage. Items still appear in history; the secret value is gone."
  >
    {#snippet children()}
      <Toggle checked={secretRedactionService.settings.master} onchange={toggleMaster} />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label="Clipboard items"
    description="Detect and redact secrets in copied text, HTML, and RTF before storing."
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
    label="Snippets"
    description="Detect and redact secrets in snippet expansions on save."
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
    label="AI conversations"
    description="Redact user-typed messages before storing AND before sending to the AI provider."
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
    label="This session"
    description="Number of redaction events since the launcher started."
  >
    {#snippet children()}
      <Badge text={`${totalRedacted} redacted`} variant="info" />
    {/snippet}
  </SettingsRow>

  <SettingsRow
    label="Active detectors"
    description="The bundled rule catalog. Updating the catalog requires a launcher update."
  >
    {#snippet children()}
      {#if secretRedactionService.catalog.length === 0}
        <EmptyState message="No detectors loaded" />
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
