<script lang="ts">
  import { SettingsCard, SettingsRow, Toggle } from '../index';
  import {
    snippetService,
    enabledPersistence,
  } from '../../built-in-features/snippets/snippetService';
  import { t } from '../../services/i18n';

  let snippetsEnabled = $state(enabledPersistence.loadSync(true));
  let snippetsToggleError = $state<string | null>(null);

  async function toggleSnippets() {
    snippetsToggleError = null;
    const next = !snippetsEnabled;
    try {
      await snippetService.setEnabled(next);
      snippetsEnabled = next;
    } catch (e) {
      snippetsToggleError = (e as Error).message || 'Failed to update snippets state';
    }
  }
</script>

<SettingsCard>
  <div id="snippets-text-expansion">
    <SettingsRow
      label={t('settings.advanced.text_expansion')}
      description={t('settings.advanced.text_expansion_description')}
    >
      <Toggle checked={snippetsEnabled} onchange={toggleSnippets} />
    </SettingsRow>
  </div>
</SettingsCard>

{#if snippetsToggleError}
  <div class="error-message">{snippetsToggleError}</div>
{/if}

<style>
  .error-message {
    font-size: var(--font-size-sm);
    font-weight: 500;
    color: var(--accent-danger);
  }
</style>
